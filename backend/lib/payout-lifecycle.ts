/**
 * The payout request lifecycle: which admin action may happen from which
 * status, and what each one needs. Pure, so every rule is tested on its own.
 *
 *   pending ──approve──▶ approved ──process──▶ processing ──mark_paid──▶ paid
 *      │                    │                     │
 *      │                    │                 mark_failed
 *      │                    │                     ▼
 *      └──reject──┐   ┌─reject┘   failed ──process (retry)──▶ processing
 *                 ▼   ▼             │
 *               rejected ◀──reject──┘
 *
 * Approval is a separate, required step (no pending → processing), and
 * approving never marks anything paid. Paid and rejected are final.
 */

export const PAYOUT_STATUSES = [
  "pending",
  "approved",
  "processing",
  "paid",
  "failed",
  "rejected",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_ACTIONS = [
  "approve",
  "process",
  "mark_paid",
  "mark_failed",
  "reject",
] as const;
export type PayoutAction = (typeof PAYOUT_ACTIONS)[number];

/** For each action: the statuses it may start from, and where it leads. */
const RULES: Record<PayoutAction, { from: readonly PayoutStatus[]; to: PayoutStatus }> = {
  approve: { from: ["pending"], to: "approved" },
  process: { from: ["approved", "failed"], to: "processing" },
  mark_paid: { from: ["processing"], to: "paid" },
  mark_failed: { from: ["processing"], to: "failed" },
  reject: { from: ["pending", "approved", "failed"], to: "rejected" },
};

export const FINAL_STATUSES: readonly PayoutStatus[] = ["paid", "rejected"];

export function isPayoutStatus(value: string): value is PayoutStatus {
  return (PAYOUT_STATUSES as readonly string[]).includes(value);
}

/** The status an action leads to from `from`, or null if it is not allowed. */
export function nextStatus(from: string, action: PayoutAction): PayoutStatus | null {
  const rule = RULES[action];
  return (rule.from as readonly string[]).includes(from) ? rule.to : null;
}

/** The actions an admin may take on a request in this status (for buttons). */
export function allowedActions(from: string): PayoutAction[] {
  return PAYOUT_ACTIONS.filter((action) => nextStatus(from, action) !== null);
}

export const REJECTION_REASON_MIN = 10;
export const REJECTION_REASON_MAX = 500;
export const NOTE_MAX = 500;
export const PAYMENT_REFERENCE_MAX = 120;

export type ActionInput = {
  action: PayoutAction;
  reason?: string | null;
  paymentReference?: string | null;
  note?: string | null;
};

export type ValidatedAction = {
  action: PayoutAction;
  to: PayoutStatus;
  /** Shown to the organiser (rejection reason, failure note). */
  organiserNote: string | null;
  /** Kept in the history only. */
  historyNote: string | null;
  paymentReference: string | null;
};

/**
 * Checks an action against the request's current status and its own
 * requirements. Returns the error to show, or what to write.
 */
export function validateAction(
  from: string,
  input: ActionInput
): { ok: true; value: ValidatedAction } | { ok: false; error: string } {
  const to = nextStatus(from, input.action);
  if (!to) {
    if (FINAL_STATUSES.includes(from as PayoutStatus)) {
      return { ok: false, error: `This request is already ${from} and can't be changed.` };
    }
    return { ok: false, error: `A ${from} request can't be moved that way.` };
  }

  const reason = (input.reason ?? "").trim();
  const reference = (input.paymentReference ?? "").trim();
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };
  }

  if (input.action === "reject") {
    if (reason.length < REJECTION_REASON_MIN) {
      return {
        ok: false,
        error: `Give the organiser a reason of at least ${REJECTION_REASON_MIN} characters.`,
      };
    }
    if (reason.length > REJECTION_REASON_MAX) {
      return { ok: false, error: `Keep the reason under ${REJECTION_REASON_MAX} characters.` };
    }
    return {
      ok: true,
      value: { action: input.action, to, organiserNote: reason, historyNote: reason, paymentReference: null },
    };
  }

  if (input.action === "mark_paid") {
    if (reference.length < 4) {
      return { ok: false, error: "Enter the bank transfer reference for this payment." };
    }
    if (reference.length > PAYMENT_REFERENCE_MAX) {
      return { ok: false, error: `Keep the reference under ${PAYMENT_REFERENCE_MAX} characters.` };
    }
    return {
      ok: true,
      value: { action: input.action, to, organiserNote: null, historyNote: note || null, paymentReference: reference },
    };
  }

  if (input.action === "mark_failed") {
    // The organiser sees why; the money stays held until retry or rejection.
    return {
      ok: true,
      value: { action: input.action, to, organiserNote: note || null, historyNote: note || null, paymentReference: null },
    };
  }

  return {
    ok: true,
    value: { action: input.action, to, organiserNote: null, historyNote: note || null, paymentReference: null },
  };
}
