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
 * Flat, every event, no launch exceptions: a 0% promo would not have made
 * anything free anyway, since Paystack still charges on every sale, so the
 * per-event rate machinery it needed was complexity buying nothing.
 *
 * `organizations.fee_percent` exists in the schema with its own default and
 * a comment claiming pricing lives there, but nothing reads that column.
 * Until it is either wired up or dropped, this constant is the single
 * source of truth — do not add a second one.
 */
export const PLATFORM_FEE_RATE = 0.05;

// Paystack Nigeria, local cards: 1.5% + ₦100, the flat fee waived on small
// transactions, the whole fee capped. Verified against a live test charge:
// ₦5,300 was charged as ₦5,482.24 — (5300 + 100) / (1 - 0.015) rounded UP to
// the kobo, which is how they do it.
const PAYSTACK_RATE = 0.015;
const PAYSTACK_FLAT = 100;
const PAYSTACK_FLAT_WAIVED_BELOW = 2500;
const PAYSTACK_FEE_CAP = 2000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Paystack rounds its own charge UP to the kobo, not to nearest: a ₦5,300
// settlement was charged as ₦5,482.24 where the formula gives ₦5,482.2335.
// Rounding to nearest under-quotes by a kobo, which is small money but makes
// "the page and the charge agree" quietly untrue.
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

// Settlement amounts are rounded DOWN to the kobo. Rounding to nearest can
// raise the amount by half a kobo, which is enough to push the resulting
// charge a kobo past the buyer's quoted total — and the solver below then
// discards the right answer and falls back to a far worse one.
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/** Who carries Paystack's processing charge. */
export type FeeStrategy = "buyer_pays" | "organizer_absorbs";

/** Who carries a given fee. */
export type FeeBearer = "organizer" | "buyer";

/**
 * What the platform keeps when a ticket is refunded.
 *
 * A refund still costs us the work already done — the sale, the QR, the
 * email, the support — but not all of it, so half the usual cut is returned
 * with the ticket price. Whoever paid the fee gets that half back. Keep this
 * at half of PLATFORM_FEE_RATE unless there is a reason not to.
 */
export const REFUND_RETAINED_RATE = 0.025;

/**
 * What Paystack charges the buyer so that `amount` reaches the merchant,
 * given the account is set to pass processing fees to the customer.
 */
export function paystackGrossUp(amount: number): number {
  const flat = amount < PAYSTACK_FLAT_WAIVED_BELOW ? 0 : PAYSTACK_FLAT;
  let charged = ceil2((amount + flat) / (1 - PAYSTACK_RATE));
  if (charged - amount > PAYSTACK_FEE_CAP) charged = round2(amount + PAYSTACK_FEE_CAP);
  return charged;
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
  /** Face value of the tickets — the price on the tin. */
  subtotal: number;
  /**
   * The platform's cut. Deducted from the organizer's payout; it is NEVER
   * added to what the buyer is charged.
   */
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
  /** Which side carries the platform fee. */
  platformFeePaidBy: FeeBearer;
  /** Which side carries Paystack's card charge. */
  processingFeePaidBy: FeeBearer;
};

/**
 * Two fees, and each one can sit on either side.
 *
 * - The platform fee is ours. By default it comes out of the organizer's
 *   payout so the buyer pays the sticker price, but an organizer can pass
 *   it on, in which case it is added to the buyer's bill and the organizer
 *   receives the ticket price whole.
 * - Paystack's card charge works the same way, independently.
 *
 * Whatever the combination, `buyerTotal` is the number the event page shows
 * and the number the buyer is actually charged — there are no hidden
 * additions at the payment screen.
 */
export function quoteOrder(
  subtotal: number,
  options: {
    platformFeePaidBy?: FeeBearer;
    processingFeePaidBy?: FeeBearer;
  } = {}
): Quote {
  const platformFeePaidBy = options.platformFeePaidBy ?? "organizer";
  const processingFeePaidBy = options.processingFeePaidBy ?? "buyer";

  const platformFee = round2(subtotal * PLATFORM_FEE_RATE);

  // A free ticket has no fees of any kind and never touches Paystack.
  if (subtotal <= 0) {
    return {
      subtotal: 0,
      platformFee: 0,
      processingFee: 0,
      buyerTotal: 0,
      organizerNet: 0,
      paystackAmount: 0,
      platformFeePaidBy,
      processingFeePaidBy,
    };
  }

  // What the charge has to cover before Paystack is considered.
  const base =
    platformFeePaidBy === "buyer" ? round2(subtotal + platformFee) : round2(subtotal);

  // The organizer's starting position: the ticket price, less our cut when
  // they are the one carrying it.
  const netBeforeCard =
    platformFeePaidBy === "buyer" ? round2(subtotal) : round2(subtotal - platformFee);

  if (processingFeePaidBy === "buyer") {
    // Paystack's cut is added on top, so `base` settles to us intact.
    const buyerTotal = paystackGrossUp(base);
    return {
      subtotal: round2(subtotal),
      platformFee,
      processingFee: round2(buyerTotal - base),
      buyerTotal,
      organizerNet: netBeforeCard,
      paystackAmount: base,
      platformFeePaidBy,
      processingFeePaidBy,
    };
  }

  // The organizer absorbs it: the buyer pays `base` exactly, so we initialize
  // for less and Paystack's cut comes out of what settles.
  const paystackAmount = paystackReverseGrossUp(base);
  const processingFee = round2(base - paystackAmount);
  return {
    subtotal: round2(subtotal),
    platformFee,
    processingFee,
    buyerTotal: base,
    organizerNet: round2(netBeforeCard - processingFee),
    paystackAmount,
    platformFeePaidBy,
    processingFeePaidBy,
  };
}

/**
 * What a refund returns and what we keep.
 *
 * The buyer always gets the ticket price back. If they also paid the
 * platform fee, they get the refundable half of that too — we retain
 * REFUND_RETAINED_RATE either way, from whoever originally paid it.
 */
export function quoteRefund(
  faceValue: number,
  platformFeePaidBy: FeeBearer = "organizer"
): {
  /** Cash returned to the buyer. */
  buyerRefund: number;
  /** What the platform keeps on this refunded sale. */
  platformKeeps: number;
  /** What the organizer is charged for it (zero when the buyer paid). */
  organizerCharged: number;
} {
  const retained = round2(faceValue * REFUND_RETAINED_RATE);
  const fullFee = round2(faceValue * PLATFORM_FEE_RATE);

  if (faceValue <= 0) {
    return { buyerRefund: 0, platformKeeps: 0, organizerCharged: 0 };
  }

  if (platformFeePaidBy === "buyer") {
    // The buyer paid our fee, so the refundable half goes back to them.
    return {
      buyerRefund: round2(faceValue + fullFee - retained),
      platformKeeps: retained,
      organizerCharged: 0,
    };
  }

  return {
    buyerRefund: round2(faceValue),
    platformKeeps: retained,
    organizerCharged: retained,
  };
}

/**
 * What a refund returns when the ORGANISER cancelled the event.
 *
 * Deliberately not quoteRefund. The two look similar and mean opposite
 * things: quoteRefund covers a buyer changing their mind about an event that
 * is still going ahead, where retaining half the cut pays for work already
 * done. Here the event is not happening. Nobody was served, so there is
 * nothing to charge for, and the platform keeps zero.
 *
 * The buyer gets back every naira that left their account — ticket price
 * plus our fee if they were the one who paid it.
 *
 * What this does NOT undo is Paystack's own processing charge. Paystack
 * keeps that on a refunded transaction, so it is a real loss landing on
 * whoever carried it originally — the organiser on a buyer_pays event, since
 * the buyer is being made whole. Returned as its own number rather than
 * folded into a total, because an organiser cancelling an event deserves to
 * be told that figure rather than find it later in a payout statement.
 */
export function quoteCancellationRefund(
  faceValue: number,
  platformFeePaidBy: FeeBearer = "organizer"
): {
  /** Cash returned to the buyer: everything they paid us. */
  buyerRefund: number;
  /** Always zero. The event did not happen. */
  platformKeeps: number;
  /** Our fee handed back, when the organiser was the one who paid it. */
  organizerRefunded: number;
  /** Paystack's cut, which nobody gets back. */
  processingLost: number;
} {
  if (faceValue <= 0) {
    return {
      buyerRefund: 0,
      platformKeeps: 0,
      organizerRefunded: 0,
      processingLost: 0,
    };
  }

  const fullFee = round2(faceValue * PLATFORM_FEE_RATE);
  const buyerPaid = platformFeePaidBy === "buyer";
  const charged = buyerPaid ? round2(faceValue + fullFee) : round2(faceValue);

  return {
    buyerRefund: charged,
    platformKeeps: 0,
    // When the buyer paid our fee it goes back to them inside buyerRefund
    // above; when the organiser paid it, they simply stop being charged it.
    organizerRefunded: buyerPaid ? 0 : fullFee,
    processingLost: round2(paystackGrossUp(charged) - charged),
  };
}

export const naira = (value: number) =>
  `₦${value.toLocaleString("en-NG", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
