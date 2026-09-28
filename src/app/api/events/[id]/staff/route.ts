import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff, users } from "@/db/schema";
import { requireEventCapability } from "@/lib/authz";
import { ASSIGNABLE_ROLES, supportsFinanceSwitch } from "@/lib/permissions";
import { sendEmailWithResult } from "@/lib/email-service";

type RouteContext = { params: Promise<{ id: string }> };

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  // `finance` is gone from here: an organiser who wants someone on the
  // money now picks Editor or Viewer and turns the switch on, which is the
  // same grant expressed as the two decisions they were really making.
  role: z.enum(["event_manager", "viewer", "gate_staff", "promoter"]),
  canSeeFinances: z.boolean().optional(),
});

/** GET /api/events/:id/staff — who works this event. */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireEventCapability(id, "team:manage");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const rows = await db
    .select({
      id: eventStaff.id,
      email: eventStaff.userEmail,
      role: eventStaff.role,
      canSeeFinances: eventStaff.canSeeFinances,
      refCode: eventStaff.refCode,
      status: eventStaff.status,
      invitedAt: eventStaff.invitedAt,
      joinedAt: eventStaff.joinedAt,
      name: users.name,
    })
    .from(eventStaff)
    .leftJoin(users, eq(eventStaff.userId, users.id))
    .where(eq(eventStaff.eventId, id));

  return NextResponse.json({ staff: rows, yourRole: access.role });
}

/** POST /api/events/:id/staff — invite someone onto this event. */
/**
 * A short, human-sayable code for a promoter's share link.
 *
 * Ambiguous characters are left out (no O/0, I/1, S/5) because these get
 * read aloud in a hall and typed by hand from a WhatsApp status. Uniqueness
 * is per event, and the loop re-rolls on the rare clash rather than trusting
 * randomness — the index would reject a duplicate anyway, and losing a role
 * assignment to a collision would be an absurd way to fail.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

async function mintRefCode(eventId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from(
      { length: 6 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join("");

    const [clash] = await db
      .select({ id: eventStaff.id })
      .from(eventStaff)
      .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.refCode, code)))
      .limit(1);

    if (!clash) return code;
  }
  // 29^6 is about 600 million; eight straight collisions means something is
  // wrong with the random source, and a long fallback is better than a loop.
  return `P${Date.now().toString(36).toUpperCase()}`;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireEventCapability(id, "team:manage");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  if (!ASSIGNABLE_ROLES.includes(parsed.data.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: eventStaff.id, status: eventStaff.status })
    .from(eventStaff)
    .where(
      and(eq(eventStaff.eventId, id), eq(eventStaff.userEmail, email))
    )
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "That person is already on this event's team." },
      { status: 409 }
    );
  }

  // If they already have an account, bind it now so the invite is one click.
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const inviteToken = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const [invite] = await db
    .insert(eventStaff)
    .values({
      // Minted here, not on first use: a promoter who signs in to find no
      // link yet has nothing to do and no way to ask for one.
      refCode:
        parsed.data.role === "promoter" ? await mintRefCode(id) : null,
      // Only honoured for roles the switch is meaningful on. A ticked box
      // must not be able to hand the payout page to a door volunteer.
      canSeeFinances:
        supportsFinanceSwitch(parsed.data.role) &&
        parsed.data.canSeeFinances === true,
      eventId: id,
      userId: user?.id ?? null,
      userEmail: email,
      role: parsed.data.role,
      status: "pending",
      inviteToken,
      invitedAt: new Date(),
      invitedBy: access.userId,
    })
    .returning();

  const inviteUrl = appUrl(`/team/accept-invite?token=${inviteToken}`);

  const sent = await sendEmailWithResult({
    to: email,
    subject: "You've been added to " + access.event.title,
    html: `
      <h2>You're on the team</h2>
      <p>You've been invited to help run <strong>${access.event.title}</strong> on Wetin Dey.</p>
      <p>Role: <strong>${parsed.data.role.replace(/_/g, " ").toUpperCase()}</strong></p>
      <p>
        <a href="${inviteUrl}" style="background-color:#12372A;color:#ffffff;padding:10px 20px;border-radius:5px;text-decoration:none;display:inline-block;">
          Accept invitation
        </a>
      </p>
      <p>This link expires in 7 days.</p>
    `,
  });

  // The invite row is what actually grants access, so a failed email is not
  // a failed invite — but the organizer needs to know, and needs the link.
  return NextResponse.json(
    {
      staff: invite,
      emailSent: sent.ok,
      ...(sent.ok ? {} : { inviteUrl, emailError: sent.error }),
    },
    { status: 201 }
  );
}
