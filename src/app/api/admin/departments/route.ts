import { NextResponse } from "next/server";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, faculties, universities, users } from "@/db/schema";
import { getSessionUserId, isPlatformAdmin } from "@/lib/authz";

async function guard() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/admin/departments — the review queue.
 *
 * Two things need a human: departments students typed themselves, and the
 * seeded ones no public source could attribute to a faculty. Both are listed
 * with how many students they affect, because a suggestion twelve people
 * picked is a different decision from one person's typo.
 */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const rows = await db
    .select()
    .from(departments)
    .orderBy(asc(departments.name));

  const [facultyRows, uniRows] = await Promise.all([
    db.select().from(faculties).orderBy(asc(faculties.name)),
    db.select().from(universities),
  ]);

  const counts = await db
    .select({
      departmentId: users.departmentId,
      students: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(
      inArray(
        users.departmentId,
        rows.length ? rows.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]
      )
    )
    .groupBy(users.departmentId);

  const studentsById = new Map(counts.map((c) => [c.departmentId, c.students]));
  const uniById = new Map(uniRows.map((u) => [u.id, u.shortName]));

  const shape = (d: (typeof rows)[number]) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    universityId: d.universityId,
    university: uniById.get(d.universityId) ?? "",
    facultyId: d.facultyId,
    students: studentsById.get(d.id) ?? 0,
    createdAt: d.createdAt,
  });

  return NextResponse.json({
    pending: rows.filter((d) => d.status === "pending").map(shape),
    unplaced: rows
      .filter((d) => d.status !== "pending" && d.status !== "rejected" && !d.facultyId)
      .map(shape),
    faculties: facultyRows.map((f) => ({
      id: f.id,
      name: f.name,
      universityId: f.universityId,
    })),
    counts: {
      pending: rows.filter((d) => d.status === "pending").length,
      unplaced: rows.filter(
        (d) => d.status !== "pending" && d.status !== "rejected" && !d.facultyId
      ).length,
      confirmed: rows.filter((d) => d.status === "confirmed").length,
      total: rows.length,
    },
  });
}

/**
 * PATCH /api/admin/departments — approve, reject, rename, assign a faculty,
 * or merge a duplicate into the real department.
 *
 * Merging is the one that matters. A student typing "Comp Sci" when
 * "Computer Science" exists should not leave two rows: their account is
 * moved onto the real one and the duplicate goes away.
 */
export async function PATCH(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const id: string | undefined = body?.id;
  const action: string | undefined = body?.action;
  if (!id || !action) {
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
  }

  const [dept] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!dept) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "approve") {
    const [updated] = await db
      .update(departments)
      .set({ status: "confirmed" })
      .where(eq(departments.id, id))
      .returning();
    return NextResponse.json({ department: updated });
  }

  if (action === "reject") {
    // Kept rather than deleted: the students who chose it stay pointed at it,
    // and deleting would silently blank their profile. Rejected departments
    // are simply never offered to anyone else.
    const [updated] = await db
      .update(departments)
      .set({ status: "rejected" })
      .where(eq(departments.id, id))
      .returning();
    return NextResponse.json({ department: updated });
  }

  if (action === "rename") {
    const name: string = (body?.name ?? "").trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "Name is too short" }, { status: 400 });
    }
    const [updated] = await db
      .update(departments)
      .set({ name })
      .where(eq(departments.id, id))
      .returning();
    return NextResponse.json({ department: updated });
  }

  if (action === "assign-faculty") {
    const facultyId: string | null = body?.facultyId ?? null;
    if (facultyId) {
      const [faculty] = await db
        .select()
        .from(faculties)
        .where(eq(faculties.id, facultyId))
        .limit(1);
      if (!faculty || faculty.universityId !== dept.universityId) {
        return NextResponse.json(
          { error: "That faculty belongs to a different university." },
          { status: 400 }
        );
      }
    }
    const [updated] = await db
      .update(departments)
      .set({ facultyId })
      .where(eq(departments.id, id))
      .returning();
    return NextResponse.json({ department: updated });
  }

  if (action === "merge") {
    const intoId: string | undefined = body?.intoId;
    if (!intoId || intoId === id) {
      return NextResponse.json({ error: "Pick a different department to merge into" }, { status: 400 });
    }
    const [target] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, intoId))
      .limit(1);
    if (!target || target.universityId !== dept.universityId) {
      return NextResponse.json(
        { error: "Can only merge within the same university." },
        { status: 400 }
      );
    }

    const moved = await db.transaction(async (tx) => {
      const affected = await tx
        .update(users)
        .set({ departmentId: intoId })
        .where(eq(users.departmentId, id))
        .returning({ id: users.id });
      await tx.delete(departments).where(eq(departments.id, id));
      return affected.length;
    });

    return NextResponse.json({ mergedInto: target.name, studentsMoved: moved });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
