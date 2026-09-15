/**
 * One definition of what a ticket costs, who pays which fee, and what the
 * organizer keeps.
 *
 * The buyer used to see ₦5,000 on the event page and then ₦5,482.24 on the
 * Paystack screen, because two fees were applied after the page had already
 * quoted a price. Quoting the real total up front is the whole point of this
 * module — the page and the charge have to agree.
 */

/**
 * The platform's cut of the ticket price, and the ONLY place it is defined.
 *
 * `organizations.fee_percent` exists in the schema with its own default and
 * a comment claiming pricing lives there, but nothing reads that column.
 * Until it is either wired up or dropped, this constant is the single
 * source of truth — do not add a second one.
 */
export const PLATFORM_FEE_RATE = 0.08;

// Paystack Nigeria, local cards: 1.5% + ₦100, the flat fee waived on small
// transactions, the whole fee capped. Verified against a live test charge:
// ₦5,300 was charged as ₦5,482.24, exactly (5300 + 100) / (1 - 0.015).
const PAYSTACK_RATE = 0.015;
const PAYSTACK_FLAT = 100;
const PAYSTACK_FLAT_WAIVED_BELOW = 2500;
const PAYSTACK_FEE_CAP = 2000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Settlement amounts are rounded DOWN to the kobo. Rounding to nearest can
// raise the amount by half a kobo, which is enough to push the resulting
// charge a kobo past the buyer's quoted total — and the solver below then
// discards the right answer and falls back to a far worse one.
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/**
 * Who carries Paystack's processing fee.
 *
 * The platform fee always comes from the buyer either way — this only moves
 * the processing charge.
 */
export type FeeStrategy = "buyer_pays" | "organizer_absorbs";

/**
 * What Paystack charges the buyer so that `amount` reaches the merchant,
 * given the account is set to pass processing fees to the customer.
 */
export function paystackGrossUp(amount: number): number {
  const flat = amount < PAYSTACK_FLAT_WAIVED_BELOW ? 0 : PAYSTACK_FLAT;
  let charged = (amount + flat) / (1 - PAYSTACK_RATE);
  if (charged - amount > PAYSTACK_FEE_CAP) charged = amount + PAYSTACK_FEE_CAP;
  return round2(charged);
}

/**
 * The inverse: the amount to initialize a transaction for so the buyer is
 * charged exactly `target`.
 *
 * Needed because the Paystack account is configured to pass fees to the
 * customer globally — that setting can't be flipped per transaction. To let
 * an organizer absorb the fee we initialize for a smaller amount, so that
 * once Paystack adds its cut the buyer pays the round number they were
 * quoted, and the difference comes out of what the organizer receives.
 */
export function paystackReverseGrossUp(target: number): number {
  // paystackGrossUp is not a smooth curve: the flat fee switches on once the
  // settled amount reaches the waiver threshold, which leaves a band of
  // charge totals that no settlement amount produces exactly. A formula
  // alone therefore cannot be trusted here — ₦2,400 lands squarely in that
  // gap — so every candidate is checked against the real gross-up and only
  // those that do not overshoot survive. Undercharging by a kobo costs the
  // organizer a kobo; overcharging breaks the promise that the buyer pays
  // the number they were shown.
  const candidates = [
    floor2(target * (1 - PAYSTACK_RATE) - PAYSTACK_FLAT), // flat applies
    floor2(target * (1 - PAYSTACK_RATE)),                 // flat waived
    floor2(target - PAYSTACK_FEE_CAP),                    // fee capped
    floor2(PAYSTACK_FLAT_WAIVED_BELOW - 0.01),            // top of the waived band
  ];

  const workable = candidates.filter(
    (amount) => amount > 0 && paystackGrossUp(amount) <= target
  );

  if (workable.length === 0) return floor2(target * (1 - PAYSTACK_RATE));
  return Math.max(...workable);
}

export type Quote = {
  /** Face value of the tickets. */
  subtotal: number;
  /** The platform's fee. Always paid by the buyer. */
  platformFee: number;
  /** Paystack's processing fee, estimated for a local card. */
  processingFee: number;
  /** What the buyer actually pays — the number shown on the event page. */
  buyerTotal: number;
  /** What reaches the organizer after every fee. */
  organizerNet: number;
  /**
   * The amount to initialize the Paystack transaction for. NOT the same as
   * buyerTotal: the account adds its fee on top of whatever we send.
   */
  paystackAmount: number;
  /** Which side carries the processing fee. */
  strategy: FeeStrategy;
};

export function quoteOrder(
  subtotal: number,
  strategy: FeeStrategy = "buyer_pays"
): Quote {
  const platformFee = round2(subtotal * PLATFORM_FEE_RATE);
  // What has to reach us: the organizer's money plus our cut.
  const merchantTotal = round2(subtotal + platformFee);

  // A free ticket has no fees of any kind and never touches Paystack.
  if (subtotal <= 0) {
    return {
      subtotal: 0,
      platformFee: 0,
      processingFee: 0,
      buyerTotal: 0,
      organizerNet: 0,
      paystackAmount: 0,
      strategy,
    };
  }

  if (strategy === "buyer_pays") {
    const buyerTotal = paystackGrossUp(merchantTotal);
    return {
      subtotal: round2(subtotal),
      platformFee,
      processingFee: round2(buyerTotal - merchantTotal),
      buyerTotal,
      organizerNet: round2(subtotal),
      paystackAmount: merchantTotal,
      strategy,
    };
  }

  // organizer_absorbs: the buyer pays the round number, and Paystack's cut
  // is taken out of what settles, so the organizer nets less.
  const paystackAmount = paystackReverseGrossUp(merchantTotal);
  const processingFee = round2(merchantTotal - paystackAmount);
  return {
    subtotal: round2(subtotal),
    platformFee,
    processingFee,
    buyerTotal: merchantTotal,
    organizerNet: round2(subtotal - processingFee),
    paystackAmount,
    strategy,
  };
}

export const naira = (value: number) =>
  `₦${value.toLocaleString("en-NG", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
