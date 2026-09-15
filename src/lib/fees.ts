/**
 * One definition of what a ticket costs, who pays which fee, and what the
 * organizer keeps.
 *
 * The buyer used to see ₦5,000 on the event page and then ₦5,482.24 on the
 * Paystack screen, because two fees were applied after the page had already
 * quoted a price: our platform fee, and Paystack's own fee grossed up onto
 * the customer. Quoting the real total up front is the whole point of this
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

export type Quote = {
  /** Face value of the tickets. */
  subtotal: number;
  /** The platform's fee. */
  platformFee: number;
  /** Paystack's processing fee, estimated for a local card. */
  processingFee: number;
  /** What the buyer actually pays. */
  buyerTotal: number;
  /** What reaches the organizer. */
  organizerNet: number;
};

export function quoteOrder(subtotal: number): Quote {
  const platformFee = round2(subtotal * PLATFORM_FEE_RATE);
  const merchantTotal = round2(subtotal + platformFee);
  const buyerTotal = paystackGrossUp(merchantTotal);
  return {
    subtotal: round2(subtotal),
    platformFee,
    processingFee: round2(buyerTotal - merchantTotal),
    buyerTotal,
    organizerNet: round2(subtotal),
  };
}

export const naira = (value: number) =>
  `₦${value.toLocaleString("en-NG", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
