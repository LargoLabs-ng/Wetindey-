import { eq } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff, events, organizationMembers, organizations } from "@/db/schema";
import type { OrgRole } from "@/lib/authz";

/** The invite email promises 7 days — this is what actually enforces it. */
export const INVITE_TTL_DAYS = 7;

export type InviteResolution =
  | { state: "missing" }
  | { state: "unknown" }
  | { state: "used" }
  | { state: "expired"; expiresAt: Date }
  | {
      state: "valid";
      /** "org" = joins the company, "event" = staffed onto one event. */
      kind: "org" | "event";
      rowId: string;
      email: string;
      role: OrgRole;
      /** Organization name, or event title — whatever they're joining. */
      contextName: string;
      expiresAt: Date;
    };

function expiryOf(invitedAt: Date | null, createdAt: Date) {
  const from = invitedAt ?? createdAt;
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Look up a pending invite of either kind and say plainly why it can't be
 * used. Shared by the accept-invite page (to render state) and the accept
 * API (to apply it), so the two can never disagree.
 */
export async function resolveInvite(
  token: string | null | undefined
): Promise<InviteResolution> {
  if (!token) return { state: "missing" };

  // Event staffing invite
  const [staff] = await db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.inviteToken, token))
    .limit(1);

  if (staff) {
    if (staff.status !== "pending") return { state: "used" };
    const expiresAt = expiryOf(staff.invitedAt, staff.createdAt);
    if (expiresAt < new Date()) return { state: "expired", expiresAt };

    const [event] = await db
      .select({ title: events.title })
      .from(events)
      .where(eq(events.id, staff.eventId))
      .limit(1);

    return {
      state: "valid",
      kind: "event",
      rowId: staff.id,
      email: staff.userEmail,
      role: staff.role as OrgRole,
      contextName: event?.title ?? "this event",
      expiresAt,
    };
  }

  // Organization membership invite
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.inviteToken, token))
    .limit(1);

  if (!member) return { state: "unknown" };
  if (member.status !== "pending") return { state: "used" };

  const expiresAt = expiryOf(member.invitedAt, member.createdAt);
  if (expiresAt < new Date()) return { state: "expired", expiresAt };

  const [organization] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, member.organizationId))
    .limit(1);

  return {
    state: "valid",
    kind: "org",
    rowId: member.id,
    email: member.userEmail ?? "",
    role: member.role as OrgRole,
    contextName: organization?.name ?? "this organization",
    expiresAt,
  };
}
