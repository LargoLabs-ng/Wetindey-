import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campuses, departments, universities, users } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import { suggestDepartment } from "@/lib/register";

/**
 * GET /api/profile — who the signed-in person is, and where they study.
 *
 * Campus context was previously only settable during signup, which meant
 * every account created before those fields existed was stranded with no
 * university — and since events inherit their campus from their organiser,
 * those accounts also produced events that belonged nowhere. A whole
 * discovery feature was switched off for them with no way back.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!me) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  // Names resolved server-side so the page can render something meaningful
  // before the campus list has finished loading.
  const [uni, campus, department] = await Promise.all([
    me.universityId
      ? db.query.universities.findFirst({
          where: eq(universities.id, me.universityId),
        })
      : null,
    me.campusId
      ? db.query.campuses.findFirst({ where: eq(campuses.id, me.campusId) })
      : null,
    me.departmentId
      ? db.query.departments.findFirst({
          where: eq(departments.id, me.departmentId),
        })
      : null,
  ]);

  return NextResponse.json({
    firstName: me.firstName ?? "",
    lastName: me.lastName ?? "",
    // Never editable here. Changing the address an account signs in with is
    // an authentication change, not a profile edit, and needs verification
    // of both addresses to not be an account-takeover route.
    email: me.email,
    universityId: me.universityId,
    campusId: me.campusId,
    departmentId: me.departmentId,
    universityName: uni?.shortName ?? uni?.name ?? null,
    campusName: campus?.name ?? null,
    departmentName: department?.name ?? null,
    // Surfaced so someone who suggested a department isn't left wondering
    // why it doesn't appear for anyone else.
    departmentPending: department?.status === "pending",
  });
}

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  universityId: z.string().uuid().nullable().optional(),
  campusId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  newDepartmentName: z.string().trim().max(120).optional(),
});

/** PATCH /api/profile — update name and campus context. */
export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check your name — both parts are required." },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // Validate the campus chain rather than trusting three ids that arrived
  // together. Nothing here is catastrophic if it's wrong, but a campus
  // belonging to a different university makes discovery quietly nonsense,
  // and "quietly nonsense" is the expensive kind of wrong.
  if (input.campusId) {
    const campus = await db.query.campuses.findFirst({
      where: eq(campuses.id, input.campusId),
    });
    if (!campus || campus.universityId !== input.universityId) {
      return NextResponse.json(
        { error: "That campus doesn't belong to that university." },
        { status: 400 }
      );
    }
  }

  if (input.departmentId) {
    const department = await db.query.departments.findFirst({
      where: eq(departments.id, input.departmentId),
    });
    if (!department || department.universityId !== input.universityId) {
      return NextResponse.json(
        { error: "That department doesn't belong to that university." },
        { status: 400 }
      );
    }
  }

  await db.transaction(async (tx) => {
    let departmentId = input.departmentId ?? null;

    // Same rule as signup, and the same function — a department typed here
    // lands as `pending` exactly as one typed at signup does.
    if (!departmentId && input.newDepartmentName && input.universityId) {
      departmentId = await suggestDepartment(tx, {
        universityId: input.universityId,
        name: input.newDepartmentName,
        suggestedBy: userId,
      });
    }

    await tx
      .update(users)
      .set({
        firstName: input.firstName,
        lastName: input.lastName,
        name: `${input.firstName} ${input.lastName}`,
        universityId: input.universityId ?? null,
        // Clearing the university clears what hangs off it. Leaving a campus
        // attached to a university you no longer claim is how a profile ends
        // up describing somewhere you have never been.
        campusId: input.universityId ? input.campusId ?? null : null,
        departmentId: input.universityId ? departmentId : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });

  return NextResponse.json({ ok: true });
}
