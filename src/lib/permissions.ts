import type { OrgRole } from "@/lib/authz";

/**
 * One table, one source of truth for who can do what.
 *
 * Before this existed there were only two predicates (canManageEvents,
 * canDeleteEvent), which meant `gate_staff` and `finance` were decorative:
 * the invite screen promised "check-in only" and "financials only", but a
 * gate volunteer could open the payouts page and a finance user could check
 * attendees in.
 *
 * ── Why there are four assignable roles and not six ──────────────────────
 *
 * There were six. Naming a role for every job someone might do on an event
 * meant guessing which bundles of permission people actually want, and
 * getting it wrong in both directions: "Event Manager" quietly included the
 * payout account, and "Finance" could not see the guest list even when the
 * same person was doing both jobs.
 *
 * What an organiser actually decides is two separate questions — how much
 * can this person CHANGE, and can they see the MONEY — so those are two
 * separate controls now. Roles answer the first. `canSeeFinances` answers
 * the second, and is orthogonal to all of them.
 *
 * `finance` is kept below but is no longer assignable: rows already holding
 * it keep working exactly as they did.
 */
export type Capability =
  | "event:view"        // see the event's dashboard and metrics
  | "event:edit"        // rename, reschedule, publish/unpublish
  | "event:delete"
  | "tickets:manage"    // create and edit ticket tiers
  | "attendees:view"    // guest list and CSV export
  | "checkin:perform"   // scan and manual check-in at the gate
  | "finance:view"      // payouts and revenue
  | "refund:issue"      // send money back to a buyer
  | "team:manage"       // invite, re-role and remove staff
  | "promote:sell";     // has a share link, and sees what they sold by it

const MATRIX: Record<OrgRole, Capability[]> = {
  owner: [
    "event:view",
    "event:edit",
    "event:delete",
    "tickets:manage",
    "attendees:view",
    "checkin:perform",
    "finance:view",
    "refund:issue",
    "team:manage",
    "promote:sell",
  ],

  // "Editor" to an organiser. Runs the event end to end: details, tickets,
  // guest list, the door. Money is not included by default and arrives only
  // if the organiser switches it on.
  event_manager: [
    "event:view",
    "event:edit",
    "tickets:manage",
    "attendees:view",
    "checkin:perform",
    "promote:sell",
  ],

  // Deliberately narrow: someone handed a phone at the door should see
  // nothing but the scanner.
  gate_staff: ["checkin:perform"],

  // Looks, touches nothing. A faculty advisor, a sponsor, a co-organiser you
  // have not decided to trust yet.
  viewer: ["event:view", "attendees:view"],

  // Sells on your behalf and sees only their own numbers. No event:view, so
  // the dashboard stays shut to them — the same way gate staff are kept to
  // the scanner.
  promoter: ["promote:sell"],

  // Legacy. No longer offered when inviting someone; rows that already hold
  // it keep exactly the access they had, so nobody loses the ability to do
  // their job because the model changed underneath them.
  finance: ["event:view", "finance:view", "refund:issue"],
};

/**
 * What the money switch grants, and to whom.
 *
 * Seeing only. Refunding is an action, not visibility, and it stays with the
 * Owner — "can see finances" is a checkbox somebody ticks quickly, and it
 * should not be capable of handing out the power to move money.
 *
 * Gate staff and promoters can never hold it. Granting the payout page to a
 * door volunteer because a box got ticked is precisely the accident this
 * whole file exists to prevent.
 */
const FINANCE_SWITCH_GRANTS: Capability[] = ["finance:view"];
const MAY_HOLD_FINANCE_SWITCH: OrgRole[] = ["event_manager", "viewer"];

export function can(
  role: OrgRole,
  capability: Capability,
  grant: { canSeeFinances?: boolean } = {}
): boolean {
  if (MATRIX[role]?.includes(capability)) return true;

  if (
    grant.canSeeFinances &&
    FINANCE_SWITCH_GRANTS.includes(capability) &&
    MAY_HOLD_FINANCE_SWITCH.includes(role)
  ) {
    return true;
  }

  return false;
}

export function capabilitiesFor(
  role: OrgRole,
  grant: { canSeeFinances?: boolean } = {}
): Capability[] {
  const base = MATRIX[role] ?? [];
  if (!grant.canSeeFinances || !MAY_HOLD_FINANCE_SWITCH.includes(role)) {
    return base;
  }
  return [...new Set([...base, ...FINANCE_SWITCH_GRANTS])];
}

/** Whether offering the money switch for this role makes any sense. */
export function supportsFinanceSwitch(role: OrgRole): boolean {
  return MAY_HOLD_FINANCE_SWITCH.includes(role);
}

/** Where a role should land after signing in. */
export function landingPathFor(role: OrgRole): string {
  if (role === "gate_staff") return "/checkin";
  if (role === "promoter") return "/promote";
  return "/dashboard";
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  event_manager: "Editor",
  gate_staff: "Gate staff",
  finance: "Finance (legacy)",
  viewer: "Viewer",
  promoter: "Promoter",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full access, including team and deleting the event",
  event_manager: "Runs the event — details, tickets, guest list, the door",
  gate_staff: "Scanner only. No guest list, no money",
  finance: "Older role. Revenue, payouts and refunds",
  viewer: "Read-only. Can see how it's going, changes nothing",
  promoter: "Share link and their own sales count. Nothing else",
};

/**
 * Roles that can be handed out per event.
 *
 * Ownership is org-level, and `finance` has been retired in favour of the
 * money switch — an organiser who wants someone on the money now picks
 * Editor or Viewer and turns finances on, which is the same grant expressed
 * as the two decisions they were really making.
 */
export const ASSIGNABLE_ROLES: OrgRole[] = [
  "event_manager",
  "viewer",
  "gate_staff",
  "promoter",
];
