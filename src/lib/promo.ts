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
export function checkCode(code: PromoCode | null | undefined): PromoCheck {
  if (!code) return { ok: false, reason: "We don't recognise that code." };
  if (!code.active) return { ok: false, reason: "That code isn't active." };

  if (code.usageLimit !== null && code.usedCount >= code.usageLimit) {
    return { ok: false, reason: "That code has been used up." };
  }

  return { ok: true, code };
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
  // platform and processing fees are ours and Paystack's, not the
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
  /** Paid orders that used it. */
  orders: number;
  /** Tickets across those orders. */
  tickets: number;
  /** Face value brought in, after any discount. */
  revenue: number;
  /** Given away, on a discount code. */
  discountGiven: number;
  /** Owed to the promoter, on a referral code. */
  commissionOwed: number;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
};
