/**
 * The money maths, with no database in it.
 *
 * Every figure an organiser or an admin sees about what an organiser earned,
 * and what they may withdraw, comes from these two functions:
 *
 *   orderOrganizerNet()  one order: what the organiser keeps from it
 *   computeEarnings()    all of an organisation's orders and payouts
 *
 * lib/earnings.ts loads the rows; these decide what they mean. Keeping the
 * rules here — pure, importing only ./fees — is what lets the tests and the
 * read-only balance preview run exactly the code the app runs.
 *
 * The rules:
 *   1. Only the tickets still live on an order (valid or checked in) count.
 *      Refunding one ticket out of three removes a third of the order, not
 *      all of it. An order whose status is `refunded` counts for nothing.
 *   2. The organiser keeps the ticket money less the platform fee recorded on
 *      the order at checkout (when they carried it) and any legacy Monnify
 *      fee, both scaled to the share of tickets still live. Paystack's fee is
 *      paid by the buyer and is not deducted.
 *   3. Money is SETTLED once the payment provider has paid it to Wetin Dey
 *      (payments.settled_at). Only settled money can be withdrawn.
 *   4. Available = settled net − paid out − committed, never below zero.
 *      Committed = requests pending, approved, processing or failed: money
 *      promised to a request that has not been paid or rejected.
 *
 * Deliberately NOT deducted (unchanged, documented in the README): promoter
 * commissions, and the half platform fee kept on a buyer-requested refund.
 */
import type { FeeBearer } from "./fees";

export type EarningsPaymentInput = {
  provider: string;
  /** When the provider paid this money to Wetin Dey; null = not yet. */
  settledAt: Date | null;
  /** Legacy Monnify fee taken out of the organiser's money, naira. */
  organizerProcessingFee: number;
  /** Paystack fee the buyer paid on top, naira. Shown, never deducted. */
  buyerProcessingFee: number;
};

export type EarningsOrderInput = {
  id: string;
  eventId: string;
  status: string;
  subtotal: string | number;
  /** The platform fee recorded on the order at checkout. */
  fees: string | number;
  platformFeePaidBy: FeeBearer;
  /** Every ticket issued on the order. */
  ticketCount: number;
  /** Tickets still valid or checked in. */
  keptTicketCount: number;
  /** The order's successful payment, if any. */
  payment: EarningsPaymentInput | null;
};

export type EarningsPayoutInput = {
  netAmount: string | number;
  status: string;
};

export type Earnings = {
  /** Face value of tickets still live. */
  grossSales: number;
  /** Our cut, only where the organiser carried it, on live tickets. */
  platformFee: number;
  /** Legacy Monnify fees taken from organiser earnings. */
  processingFee: number;
  /** Paystack fees buyers paid on top. Never deducted. */
  buyerProcessingFee: number;
  /** Face value of tickets refunded (or cancelled) on paid orders. */
  refunded: number;
  /** Everything the organiser has earned, settled or not. */
  netEarned: number;
  /** Face value / organiser net the provider has already paid to Wetin Dey. */
  settledGross: number;
  settledNet: number;
  /** Face value / organiser net still waiting on the provider. */
  unsettledGross: number;
  unsettledNet: number;
  /** Requests marked paid. */
  paidOut: number;
  /** Requests pending, approved, processing or failed (same as `committed`). */
  pending: number;
  committed: number;
  /** settledNet − paidOut − committed, never below zero. */
  available: number;
  /**
   * How far requests exceed settled money (0 when they do not). Requests made
   * before settlement tracking existed can be in this position; an admin must
   * look at them.
   */
  shortfall: number;
  /** Live tickets, not orders. */
  ticketsSold: number;
};

export type OrderNet = {
  keptShare: number;
  keptFace: number;
  refundedFace: number;
  platformFee: number;
  processingFee: number;
  buyerProcessingFee: number;
  net: number;
  settled: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const num = (value: string | number) => {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
};

/** Statuses whose money is promised to a request and must not be offered again. */
export const COMMITTED_PAYOUT_STATUSES = ["pending", "approved", "processing", "failed"] as const;

export function orderOrganizerNet(order: EarningsOrderInput): OrderNet {
  const subtotal = num(order.subtotal);
  let keptShare: number;
  if (order.status !== "paid") {
    keptShare = 0;
  } else if (order.ticketCount <= 0) {
    // A paid order with no ticket rows should not exist; treat it as whole
    // rather than silently erasing the sale.
    keptShare = 1;
  } else {
    keptShare = Math.min(1, Math.max(0, order.keptTicketCount / order.ticketCount));
  }

  const keptFace = round2(subtotal * keptShare);
  const platformFee =
    order.platformFeePaidBy === "organizer" ? round2(num(order.fees) * keptShare) : 0;
  const processingFee = round2((order.payment?.organizerProcessingFee ?? 0) * keptShare);
  const buyerProcessingFee = round2((order.payment?.buyerProcessingFee ?? 0) * keptShare);

  return {
    keptShare,
    keptFace,
    refundedFace: round2(subtotal - keptFace),
    platformFee,
    processingFee,
    buyerProcessingFee,
    net: round2(keptFace - platformFee - processingFee),
    // No successful payment means no money arrived: never settled.
    settled: Boolean(order.payment?.settledAt),
  };
}

export function computeEarnings(
  orders: EarningsOrderInput[],
  payouts: EarningsPayoutInput[]
): Earnings {
  let grossSales = 0;
  let platformFee = 0;
  let processingFee = 0;
  let buyerProcessingFee = 0;
  let refunded = 0;
  let settledGross = 0;
  let settledNet = 0;
  let unsettledGross = 0;
  let unsettledNet = 0;
  let ticketsSold = 0;

  for (const order of orders) {
    const result = orderOrganizerNet(order);
    refunded += result.refundedFace;
    if (result.keptShare === 0) continue;

    grossSales += result.keptFace;
    platformFee += result.platformFee;
    processingFee += result.processingFee;
    buyerProcessingFee += result.buyerProcessingFee;
    ticketsSold += order.ticketCount > 0 ? order.keptTicketCount : 0;

    if (result.settled) {
      settledGross += result.keptFace;
      settledNet += result.net;
    } else {
      unsettledGross += result.keptFace;
      unsettledNet += result.net;
    }
  }

  let paidOut = 0;
  let committed = 0;
  for (const payout of payouts) {
    const amount = num(payout.netAmount);
    if (payout.status === "paid") paidOut += amount;
    else if ((COMMITTED_PAYOUT_STATUSES as readonly string[]).includes(payout.status)) {
      committed += amount;
    }
  }

  const raw = round2(settledNet - paidOut - committed);

  return {
    grossSales: round2(grossSales),
    platformFee: round2(platformFee),
    processingFee: round2(processingFee),
    buyerProcessingFee: round2(buyerProcessingFee),
    refunded: round2(refunded),
    netEarned: round2(settledNet + unsettledNet),
    settledGross: round2(settledGross),
    settledNet: round2(settledNet),
    unsettledGross: round2(unsettledGross),
    unsettledNet: round2(unsettledNet),
    paidOut: round2(paidOut),
    pending: round2(committed),
    committed: round2(committed),
    // Never negative: an over-commitment is shown to admins as `shortfall`,
    // not to an organiser as money they owe.
    available: Math.max(0, raw),
    shortfall: raw < 0 ? round2(-raw) : 0,
    ticketsSold,
  };
}
