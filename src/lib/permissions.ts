import type { OrgRole } from "@/lib/authz";

/**
 * One table, one source of truth for who can do what.
 *
 * Before this existed there were only two predicates (canManageEvents,
 * canDeleteEvent), which meant `gate_staff` and `finance` were decorative:
 * the invite screen promised "check-in only" and "financials only", but a
 * gate volunteer could open the payouts page and a finance user could check
 * attendees in.
 */
export type Capability =
  | "event:view"        // see the event's dashboard and metrics
  | "event:edit"        // rename, reschedule, publish/unpublish
  | "event:delete"
  | "tickets:manage"    // create and edit ticket tiers
  | "attendees:view"    // guest list and CSV export
  | "checkin:perform"   // scan and manual check-in at the gate
  | "finance:view"      // payouts and revenue
  | "team:manage";      // invite, re-role and remove staff

const MATRIX: Record<OrgRole, Capability[]> = {
  owner: [
    "event:view",
    "event:edit",
    "event:delete",
    "tickets:manage",
    "attendees:view",
    "checkin:perform",
    "finance:view",
    "team:manage",
  ],
  event_manager: [
    "event:view",
    "event:edit",
    "tickets:manage",
    "attendees:view",
    "checkin:perform",
    "finance:view",
  ],
  // Deliberately narrow: someone handed a phone at the door should see
  // nothing but the scanner.
  gate_staff: ["checkin:perform"],
  finance: ["event:view", "finance:view"],
};

export function can(role: OrgRole, capability: Capability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: OrgRole): Capability[] {
  return MATRIX[role] ?? [];
}

/** Where a role should land after signing in. */
export function landingPathFor(role: OrgRole): string {
  return role === "gate_staff" ? "/checkin" : "/dashboard";
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  event_manager: "Event Manager",
  gate_staff: "Gate Staff",
  finance: "Finance",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full access, including team and deleting the event",
  event_manager: "Run the event: details, tickets, attendees, check-in",
  gate_staff: "Check-in only — cannot see money or the guest list",
  finance: "Revenue and payouts only",
};

/** Roles that can be handed out per event (ownership is org-level). */
export const ASSIGNABLE_ROLES: OrgRole[] = [
  "event_manager",
  "gate_staff",
  "finance",
];
