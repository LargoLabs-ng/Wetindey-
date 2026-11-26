/**
 * Codes people type at checkout.
 *
 * Two kinds that look identical in the box and are opposites in the ledger:
 *
 *   discount       the buyer pays less. Costs the organiser now.
 *   refer_to_earn  the buyer pays the same, and somebody is owed a cut for
 *                  bringing them. Costs the organiser later.
 *
 * ONE CODE PER ORDER, deliberately. Stacking a discount on a referral raises
 * the question of whether the promoter earns on the face value or the
 * discounted one, and there is no answer to that which both parties will
 * agree with after the fact. One box, one code, no argument.
 *
 * Pure: money in, money out, no database. The arithmetic here decides what
 * somebody is charged and what somebody else is owed, so it is tested
 * directly rather than through a checkout.
 */

export type PromoKind = "discount" | "refer_to_earn";

export type PromoCode = {
  id: string;
  kind: PromoKind;
  code: string;
  label: string | null;
  promoterName: string | null;
  /** Percent. % off for a discount, % commission for a referral. */
  rate: number;
  /** Null means unlimited. */
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  /**
   * Ticket-type limit (migration 0021). Absent or true: any ticket type.
   * false: only the types in `ticketTypeIds` — and none if that is empty,
   * so a code whose allowed tier was deleted stops working rather than
   * quietly applying to everything.
   */
  appliesToAllTiers?: boolean;
  ticketTypeIds?: string[];
  /**
   * The team member (event_staff row) a referral code belongs to, if the
   * organiser linked one. Only used to stop someone earning commission on
   * their own purchase; the commission still goes to `promoterName`.
   */
  staffId?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Codes are matched case-insensitively — nobody types SUMMER20 as written. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (!code || code.length > 32) return null;
  return code;
}

/**
 * Rates outside 0–100 are clamped rather than rejected.
 *
 * A code is data an organiser typed weeks ago; refusing a sale at checkout
 * because of it punishes the buyer for somebody else's typo. 150% off means
 * free, -5% means nothing off, and either way the ticket sells.
 */
function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, rate));
}

export type PromoCheck =
  | { ok: true; code: PromoCode }
  | { ok: false; reason: string };

/**
 * Whether a code can be used right now.
 *
 * The reasons are written to be shown to a buyer, so they say what is true
 * without implying the buyer did something wrong — "this code has been used
 * up" is a fact about the code, not an accusation.
 */
export function checkCode(
  code: PromoCode | null | undefined,
  options: { ticketTypeId?: string | null } = {}
): PromoCheck {
  if (!code) return { ok: false, reason: "We don't recognise that code." };
  if (!code.active) return { ok: false, reason: "That code isn't active." };

  if (code.usageLimit !== null && code.usedCount >= code.usageLimit) {
    return { ok: false, reason: "That code has been used up." };
  }

  if (!codeAppliesToTier(code, options.ticketTypeId)) {
    return { ok: false, reason: "That code doesn't apply to this ticket type." };
  }

  return { ok: true, code };
}

/**
 * Whether a code may be used on this ticket type.
 *
 * A limited code with no ticket type to check against is refused: the
 * caller didn't say which tier, so we can't say yes. Every current caller
 * passes one.
 */
export function codeAppliesToTier(
  code: Pick<PromoCode, "appliesToAllTiers" | "ticketTypeIds">,
  ticketTypeId: string | null | undefined
): boolean {
  if (code.appliesToAllTiers !== false) return true;
  if (!ticketTypeId) return false;
  return (code.ticketTypeIds ?? []).includes(ticketTypeId);
}

/**
 * Validate the ticket-type limits an organiser is saving.
 *
 * Returns a sentence for the organiser, or null when everything is fine.
 * `eventTierIds` are the event's own ticket types: a limit naming another
 * event's tier is refused rather than silently dropped.
 */
export function tierScopeError(
  codes: { code: string; appliesToAllTiers?: boolean; ticketTypeIds?: string[] }[],
  eventTierIds: string[]
): string | null {
  const mine = new Set(eventTierIds);
  for (const c of codes) {
    if (c.appliesToAllTiers !== false) continue;
    const ids = c.ticketTypeIds ?? [];
    if (ids.length === 0) {
      return `Pick at least one ticket type for "${c.code}", or choose All ticket types.`;
    }
    if (ids.some((id) => !mine.has(id))) {
      return `"${c.code}" names a ticket type that isn't on this event. Refresh and try again.`;
    }
  }
  return null;
}

export type PromoEffect = {
  /** Money off the ticket price. Zero for a referral. */
  discount: number;
  /** Money owed to a promoter. Zero for a discount. */
  commission: number;
  /** What the buyer is actually charged for, before fees. */
  faceAfter: number;
};

export const NO_EFFECT: PromoEffect = {
  discount: 0,
  commission: 0,
  faceAfter: 0,
};

/**
 * What a code does to one order's face value.
 *
 * `faceValue` is the ticket price times quantity, before any fee. The result
 * feeds straight into quoteOrder, so a discounted sale is quoted, charged
 * and settled on the discounted number — the fees follow the money, not the
 * sticker.
 */
export function applyPromo(
  faceValue: number,
  code: PromoCode | null | undefined
): PromoEffect {
  const face = Number.isFinite(faceValue) ? Math.max(0, faceValue) : 0;

  if (!code) return { discount: 0, commission: 0, faceAfter: round2(face) };

  const rate = clampRate(Number(code.rate));

  if (code.kind === "discount") {
    // Capped at the face value: a 100% code makes a ticket free, never
    // negative, and never something the payment provider has to think about.
    const discount = Math.min(round2((face * rate) / 100), round2(face));
    return {
      discount,
      commission: 0,
      faceAfter: round2(face - discount),
    };
  }

  // refer_to_earn: the buyer pays the same. What changes is who is owed.
  //
  // Computed on the face value because that is what the buyer paid — the
  // platform and processing fees are ours and the provider's, not the
  // organiser's to hand a promoter a share of, and not the promoter's
  // problem either.
  return {
    discount: 0,
    commission: round2((face * rate) / 100),
    faceAfter: round2(face),
  };
}

/**
 * What an organiser sees per code.
 *
 * Deliberately not a percentage of anything: an organiser paying a promoter
 * wants one number in naira, and wants it to match what they are about to
 * transfer.
 */
export type CodePerformance = {
  code: string;
  kind: PromoKind;
  label: string | null;
  promoterName: string | null;
  rate: number;
  /** Paid orders that used it and still have a ticket that counts. */
  orders: number;
  /** Tickets across those orders that still count (not refunded or cancelled). */
  tickets: number;
  /** Face value brought in, after any discount, net of refunds. */
  revenue: number;
  /** Given away, on a discount code, net of refunds. */
  discountGiven: number;
  /** Owed to the promoter, on a referral code, net of refunds and cancellations. */
  commissionOwed: number;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
};

/**
 * Add one paid order to a code's figures, counting only what still stands.
 *
 * An order's money is spread evenly across its tickets, the same rule the
 * dashboard's "Ticket sales" uses (lib/event-revenue.ts). Refund one ticket
 * of three and the order's sales, discount and commission each drop by a
 * third; cancel the event (every ticket voided) and they drop to nothing.
 * The commission frozen on the order at checkout is never changed — only
 * how much of it is still owed.
 *
 * Rounded once, when the totals are shown, not per order, so a code with
 * many part-refunded orders doesn't drift by a kobo each time.
 */
export function addOrderToPerformance(
  perf: Pick<CodePerformance, "orders" | "tickets" | "revenue" | "discountGiven" | "commissionOwed">,
  order: {
    subtotal: string | number | null;
    discountAmount: string | number | null;
    commissionAmount: string | number | null;
  },
  ticketCount: { all: number; live: number }
): void {
  const all = Math.max(0, ticketCount.all);
  const live = Math.min(Math.max(0, ticketCount.live), all);
  // An order with no tickets at all shouldn't exist; if one does, count its
  // money whole rather than make it vanish, as promoterSales does.
  const share = all > 0 ? live / all : 1;
  if (all > 0 && live === 0) return;

  perf.orders += 1;
  perf.tickets += live;
  perf.revenue += (Number(order.subtotal) || 0) * share;
  perf.discountGiven += (Number(order.discountAmount) || 0) * share;
  perf.commissionOwed += (Number(order.commissionAmount) || 0) * share;
}

/**
 * Which code an order used, as the guest list shows it.
 *
 * Read-only: this describes what an order already recorded at checkout. It
 * never decides a price.
 *
 * Deleting a code sets the order's promo_code_id to null (ON DELETE SET
 * NULL) but leaves the order's own discount and commission figures alone.
 * So an order with money recorded against it and no code row is an order
 * whose code was deleted — shown as "Deleted code" rather than as if no
 * code had been used. A deleted code that moved no money (a 0% code) can't
 * be told apart from no code at all, and shows as none.
 */
export const DELETED_CODE_LABEL = "Deleted code";

export type OrderCode = {
  /** The code as typed, or DELETED_CODE_LABEL. */
  code: string;
  kind: PromoKind;
  /** Who earns on a referral code. Null for discounts and deleted codes. */
  promoterName: string | null;
  deleted: boolean;
};

const positive = (n: string | number | null | undefined) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0;
};

export function describeOrderCode(
  order: {
    discountAmount: string | number | null | undefined;
    commissionAmount: string | number | null | undefined;
  },
  code:
    | { code: string | null; kind: PromoKind | null; promoterName: string | null }
    | null
    | undefined
): OrderCode | null {
  if (code?.code && code.kind) {
    return {
      code: code.code,
      kind: code.kind,
      promoterName: code.kind === "refer_to_earn" ? code.promoterName : null,
      deleted: false,
    };
  }

  const discounted = positive(order.discountAmount);
  if (discounted || positive(order.commissionAmount)) {
    return {
      code: DELETED_CODE_LABEL,
      // The figures still say which kind it was: a discount takes money off,
      // a referral leaves the price alone and records a commission.
      kind: discounted ? "discount" : "refer_to_earn",
      promoterName: null,
      deleted: true,
    };
  }

  return null;
}

/** "Discount" or "Referral" — the words organisers see for each kind. */
export function promoKindLabel(kind: PromoKind): string {
  return kind === "refer_to_earn" ? "Referral" : "Discount";
}
