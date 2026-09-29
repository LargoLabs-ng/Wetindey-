import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { can, type Capability } from "@/lib/permissions";
import { db } from "@/db";
import { eventStaff, events, organizationMembers } from "@/db/schema";

export type OrgRole =
  | "owner"
  | "event_manager"
  | "gate_staff"
  | "finance"
  | "viewer"
  | "promoter";

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getMembership(userId: string, organizationId: string) {
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .limit(1);
  return membership ?? null;
}

/**
 * V1 simplification: most organizers belong to exactly one Organization
 * (created for them at registration). A user with multiple memberships
 * (e.g. someone invited to a second org's team) will need an org-switcher
 * in a later phase — this just returns the first one found.
 */
export async function getPrimaryOrganizationId(
  userId: string
): Promise<string | null> {
  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);
  return membership?.organizationId ?? null;
}

// Per blueprint Section 20 — Event Manager can manage event details,
// tickets, attendees, and check-in, but not company-level settings.
// Gate Staff can only scan/search/check-in. Finance sees money, not
// operations. None of that is enforced by this function alone; each
// route composes these primitives for its specific action.
export function canManageEvents(role: OrgRole): boolean {
  return role === "owner" || role === "event_manager";
}

// Deleting an event is irreversible and destroys attendee/order history —
// restricted to Owner only, stricter than the general "manage" permission.
export function canDeleteEvent(role: OrgRole): boolean {
  return role === "owner";
}

/**
 * Every organization the user belongs to. Dashboard queries scope to this
 * list so one organizer can never read another organizer's data.
 */
export async function getOrganizationIdsForUser(
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  return rows.map((r) => r.organizationId);
}

/**
 * Postgres throws on a malformed uuid rather than returning no rows, so a
 * hand-typed URL like /dashboard/events/abc/attendees produced a 500.
 * Screen the shape first and treat anything else as "not found".
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value);
}

/**
 * What somebody holds on an event: the role, plus the switches that sit
 * beside it. Passed around as one thing so a caller cannot check the role
 * and forget the flag — which would silently deny the money page to a
 * person the organiser had explicitly granted it to.
 */
export type Grant = { role: OrgRole; canSeeFinances: boolean };

export type EventAccess =
  | {
      ok: true;
      userId: string;
      role: OrgRole;
      canSeeFinances: boolean;
      event: typeof events.$inferSelect;
    }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Single gate for every /api/dashboard/* route that takes an eventId:
 * the caller must be signed in AND be a member of the organization that
 * owns the event. Returns the event so callers don't refetch it.
 */
export async function requireEventAccess(
  eventId: string | null
): Promise<EventAccess> {
  if (!eventId) {
    return { ok: false, status: 400, error: "Missing eventId" };
  }
  if (!isUuid(eventId)) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  // Ownership is a company-level fact: the org owner runs every event the
  // org runs, without needing to be staffed onto each one.
  const membership = await getMembership(userId, event.organizationId);
  if (membership && membership.role === "owner") {
    // The owner sees everything by definition; the switch is meaningless.
    return { ok: true, userId, role: "owner", canSeeFinances: true, event };
  }

  // Everyone else has to be staffed onto this specific event.
  const [assignment] = await db
    .select()
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.eventId, event.id),
        eq(eventStaff.userId, userId),
        eq(eventStaff.status, "active")
      )
    )
    .limit(1);

  if (!assignment) {
    // Deliberately 404, not 403: don't confirm the event exists to
    // someone who has no business knowing about it.
    return { ok: false, status: 404, error: "Event not found" };
  }

  return {
    ok: true,
    userId,
    role: assignment.role as OrgRole,
    canSeeFinances: assignment.canSeeFinances,
    event,
  };
}

export type CapabilityCheck =
  | {
      ok: true;
      userId: string;
      role: OrgRole;
      canSeeFinances: boolean;
      event: typeof events.$inferSelect;
    }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Access + capability in one call, so a route can't accidentally check that
 * someone belongs to an event while forgetting to check what they may do.
 */
export async function requireEventCapability(
  eventId: string | null,
  capability: Capability
): Promise<CapabilityCheck> {
  const access = await requireEventAccess(eventId);
  if (!access.ok) return access;

  if (!can(access.role, capability, { canSeeFinances: access.canSeeFinances })) {
    return {
      ok: false,
      status: 403,
      error: "You do not have permission to do that on this event.",
    };
  }

  return access;
}

/** Events belonging to any organization the user is a member of. */
export async function getEventsForUser(userId: string) {
  const orgIds = await getOrganizationIdsForUser(userId);
  if (orgIds.length === 0) return [];
  return db
    .select()
    .from(events)
    .where(inArray(events.organizationId, orgIds));
}

export type OrgAccess =
  | { ok: true; userId: string; role: OrgRole; organizationId: string }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Gate for organization-scoped routes. Accepts either an organizationId or
 * an eventId (the dashboard's team screens are event-scoped, so they send
 * the event) and confirms the caller is actually a member.
 */
export async function requireOrgAccess(input: {
  organizationId?: string | null;
  eventId?: string | null;
}): Promise<OrgAccess> {
  if (input.eventId) {
    const access = await requireEventAccess(input.eventId);
    if (!access.ok) return access;
    return {
      ok: true,
      userId: access.userId,
      role: access.role,
      organizationId: access.event.organizationId,
    };
  }

  if (!input.organizationId) {
    return { ok: false, status: 400, error: "Missing organizationId or eventId" };
  }
  if (!isUuid(input.organizationId)) {
    return { ok: false, status: 404, error: "Organization not found" };
  }

  const userId = await getSessionUserId();
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  const membership = await getMembership(userId, input.organizationId);
  if (!membership) {
    return { ok: false, status: 404, error: "Organization not found" };
  }

  return {
    ok: true,
    userId,
    role: membership.role as OrgRole,
    organizationId: input.organizationId,
  };
}

/**
 * Platform admin check.
 *
 * There is no admin column on the users table yet, so admin access is an
 * explicit email allowlist from the ADMIN_EMAILS env var
 * (comma-separated). It fails closed: with the var unset, nobody is an
 * admin. Replace this with a real users.role column when you add one.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return false;

  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email);
}

/**
 * The role a user actually holds *on a given event*.
 *
 * Organization owners are owners everywhere in their org; everyone else is
 * only whatever the event staffing table says they are, and null if they
 * were never staffed onto it.
 */
export async function getEventRole(
  userId: string,
  event: { id: string; organizationId: string }
): Promise<OrgRole | null> {
  const membership = await getMembership(userId, event.organizationId);
  if (membership && membership.role === "owner") return "owner";

  const [assignment] = await db
    .select({ role: eventStaff.role })
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.eventId, event.id),
        eq(eventStaff.userId, userId),
        eq(eventStaff.status, "active")
      )
    )
    .limit(1);

  return (assignment?.role as OrgRole) ?? null;
}

export type StaffedEvent = {
  id: string;
  title: string;
  slug: string;
  startDatetime: Date;
  /**
   * The date is provisional and hidden from buyers. Carried here so an
   * organiser's own surfaces can mark it — the flag hides the date from the
   * public, not from the person who set it.
   */
  dateTbd: boolean;
  status: string;
  role: OrgRole;
};

/**
 * Every event this user can act on, with the role they hold on each.
 * Owned-org events come first as "owner"; staffed events follow.
 */
export async function getStaffedEvents(
  userId: string
): Promise<StaffedEvent[]> {
  const orgIds = await getOrganizationIdsForUser(userId);

  const owned = orgIds.length
    ? await db
        .select()
        .from(events)
        .where(inArray(events.organizationId, orgIds))
    : [];

  const ownedIds = new Set(owned.map((e) => e.id));

  const staffedRows = await db
    .select({ event: events, role: eventStaff.role })
    .from(eventStaff)
    .innerJoin(events, eq(eventStaff.eventId, events.id))
    .where(
      and(eq(eventStaff.userId, userId), eq(eventStaff.status, "active"))
    );

  const result: StaffedEvent[] = owned.map((e) => ({
    id: e.id,
    title: e.title,
    slug: e.slug,
    startDatetime: e.startDatetime,
    dateTbd: e.dateTbd,
    status: e.status,
    role: "owner" as OrgRole,
  }));

  for (const row of staffedRows) {
    if (ownedIds.has(row.event.id)) continue;
    result.push({
      id: row.event.id,
      title: row.event.title,
      slug: row.event.slug,
      startDatetime: row.event.startDatetime,
      dateTbd: row.event.dateTbd,
      status: row.event.status,
      role: row.role as OrgRole,
    });
  }

  return result;
}

/**
 * Should this user see the organizer dashboard at all?
 *
 * Org owners always do, even before they've created an event. Everyone else
 * needs at least one event they can view — which excludes gate staff, whose
 * whole remit is the scanner.
 */
export async function hasDashboardAccess(userId: string): Promise<boolean> {
  const staffed = await getStaffedEvents(userId);

  // Anything they can actually look at earns them the dashboard.
  if (staffed.some((e) => can(e.role, "event:view"))) return true;

  // Nothing viewable. If they are staffed on something regardless, they are
  // gate crew and belong at the scanner. Registration hands every new
  // account its own organization, so "owns an org" cannot be the test —
  // a volunteer who signed up to work one door owns an empty one too.
  if (staffed.length > 0) return false;

  // Staffed nowhere at all: a new organizer who still has to create their
  // first event.
  return true;
}
