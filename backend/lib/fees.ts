/**
 * One definition of what a ticket costs, who pays which fee, and what the
 * organizer keeps.
 *
 * The buyer used to see one price on the event page and then another on the
 * payment screen, because two fees were applied after the page had already
 * quoted a price. Quoting the real total up front is the whole point of this
 * module — the page and the charge have to agree.
 */

/**
 * The platform's cut of the ticket price, and the ONLY place it is defined.
 *
 * Flat, every event, no launch exceptions: a 0% promo would not have made
 * anything free anyway, since payment providers still charge on every sale, so the
 * per-event rate machinery it needed was complexity buying nothing.
 *
 * `organizations.fee_percent` exists in the schema with its own default and
 * a comment claiming pricing lives there, but nothing reads that column.
 * Until it is either wired up or dropped, this constant is the single
 * source of truth — do not add a second one.
 */
export const PLATFORM_FEE_RATE = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

const PAYSTACK_RATE = 0.015;
const PAYSTACK_FLAT = 100;
const PAYSTACK_FLAT_WAIVED_BELOW = 2500;
const PAYSTACK_FEE_CAP = 2000;

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

/** Estimate the Paystack charge added to a buyer's checkout total. */
export function paystackGrossUp(amount: number): number {
  const flat = amount < PAYSTACK_FLAT_WAIVED_BELOW ? 0 : PAYSTACK_FLAT;
  let charged = ceil2((amount + flat) / (1 - PAYSTACK_RATE));
  if (charged - amount > PAYSTACK_FEE_CAP) {
    charged = round2(amount + PAYSTACK_FEE_CAP);
  }
  return charged;
}

/** Reverse the gross-up when an exact buyer-facing total must be honoured. */
export function paystackReverseGrossUp(target: number): number {
  const candidates = [
    floor2(target * (1 - PAYSTACK_RATE) - PAYSTACK_FLAT),
    floor2(target * (1 - PAYSTACK_RATE)),
    floor2(target - PAYSTACK_FEE_CAP),
    floor2(PAYSTACK_FLAT_WAIVED_BELOW - 0.01),
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
  /** Estimated Paystack fee passed to the buyer. */
  processingFee: number;
  /** Merchant amount passed to Paystack before customer-paid processing fees. */
  paystackAmount: number;
  /** What the buyer actually pays — the number shown on the event page. */
  buyerTotal: number;
  /** What reaches the organizer after every fee. */
  organizerNet: number;
  /** Which side carries the platform fee. */
  platformFeePaidBy: FeeBearer;
};

/**
 * The platform fee is deducted from the organiser's ticket proceeds.
 * Paystack's processing fee is passed through to the buyer.
 *
 * - New orders deduct the platform fee from organiser proceeds. The buyer-
 *   paid platform-fee option remains only to interpret historical orders.
 *
 * Whatever the combination, `buyerTotal` is the number the event page shows
 * and the number the buyer is actually charged — there are no hidden
 * additions at the payment screen.
 */
export function quoteOrder(
  subtotal: number,
  options: {
    platformFeePaidBy?: FeeBearer;
  } = {}
): Quote {
  const platformFeePaidBy = options.platformFeePaidBy ?? "organizer";

  const platformFee = round2(subtotal * PLATFORM_FEE_RATE);

  // A free ticket has no fees of any kind and never touches the payment provider.
  if (subtotal <= 0) {
    return {
      subtotal: 0,
      platformFee: 0,
      processingFee: 0,
      paystackAmount: 0,
      buyerTotal: 0,
      organizerNet: 0,
      platformFeePaidBy,
    };
  }

  const paystackAmount =
    platformFeePaidBy === "buyer" ? round2(subtotal + platformFee) : round2(subtotal);

  // The organizer's starting position: the ticket price, less our cut when
  // they are the one carrying it.
  const netBeforeCard =
    platformFeePaidBy === "buyer" ? round2(subtotal) : round2(subtotal - platformFee);

  const buyerTotal = paystackGrossUp(paystackAmount);
  const processingFee = round2(buyerTotal - paystackAmount);
  return {
    subtotal: round2(subtotal),
    platformFee,
    processingFee,
    paystackAmount,
    buyerTotal,
    organizerNet: netBeforeCard,
    platformFeePaidBy,
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
 * The provider fee is passed to the buyer and is not part of the amount
 * refunded by the merchant.
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
  /** Provider fee not returned; zero until the merchant terms are confirmed. */
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
