import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, payouts, refunds } from "@/db/schema";
import { quoteOrder } from "@/lib/fees";

/**
 * What an organisation has earned, and what it can actually withdraw.
 *
 * One function, because this number gets shown in three places and an
 * organiser comparing two of them and finding different figures will — quite
 * reasonably — stop trusting all of them.
 */
export type Earnings = {
  /** Face value of tickets sold. What the buyers' tickets cost. */
  grossSales: number;
  /** Our cut, only counting sales where the organiser carried it. */
  platformFee: number;
  /** Paystack's cut on sales where the organiser carried it. */
  processingFee: number;
  /** Face value of sales that were refunded and no longer count. */
  refunded: number;
  /** Owed to the organiser: gross, less whichever fees they carried. */
  netEarned: number;
  /** Already sent. */
  paidOut: number;
  /** Requested and not yet sent. */
  pending: number;
  /** netEarned − paidOut − pending. What a withdrawal may draw on. */
  available: number;
  ticketsSold: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function earningsForOrganization(
  organizationId: string
): Promise<Earnings> {
  const empty: Earnings = {
    grossSales: 0,
    platformFee: 0,
    processingFee: 0,
    refunded: 0,
    netEarned: 0,
    paidOut: 0,
    pending: 0,
    available: 0,
    ticketsSold: 0,
  };

  const orgEvents = await db
    .select({
      id: events.id,
      platformFeePaidBy: events.platformFeePaidBy,
      feeStrategy: events.feeStrategy,
    })
    .from(events)
    .where(eq(events.organizationId, organizationId));

  if (orgEvents.length === 0) return empty;

  const eventIds = orgEvents.map((e) => e.id);
  const settings = new Map(orgEvents.map((e) => [e.id, e]));

  const paid = await db
    .select({
      id: orders.id,
      eventId: orders.eventId,
      subtotal: orders.subtotal,
    })
    .from(orders)
    .where(and(inArray(orders.eventId, eventIds), eq(orders.status, "paid")));

  // Orders that have been refunded stop counting. Their reversal is handled
  // by exclusion rather than by subtracting the buyer's refund: the money
  // returned to a buyer came out of the pool we were holding, not out of the
  // organiser's balance, so subtracting it would charge them twice.
  //
  // KNOWN SIMPLIFICATION: on a buyer-requested refund we retain half our fee
  // (REFUND_RETAINED_RATE) and that charge is not deducted here — about ₦125
  // on a ₦5,000 ticket, always in the organiser's favour. Doing it properly
  // needs a `kind` column on refunds to tell a buyer's change of mind apart
  // from an event we cancelled, where nothing is retained at all. Matching on
  // the reason string would work until somebody edits the wording.
  const refundRows = await db
    .select({ orderId: refunds.orderId, amount: refunds.amount })
    .from(refunds)
    .where(inArray(refunds.eventId, eventIds));

  const refundedOrders = new Set(refundRows.map((r) => r.orderId));

  let grossSales = 0;
  let platformFee = 0;
  let processingFee = 0;
  let netEarned = 0;
  let refunded = 0;
  let ticketsSold = 0;

  for (const order of paid) {
    const face = Number(order.subtotal);
    if (!Number.isFinite(face)) continue;

    if (refundedOrders.has(order.id)) {
      refunded += face;
      continue;
    }

    const config = settings.get(order.eventId);
    // Same function the event page and the order API quote from, so a
    // payout can never disagree with the price a buyer was shown.
    const quote = quoteOrder(face, {
      platformFeePaidBy: config?.platformFeePaidBy ?? "organizer",
      processingFeePaidBy:
        config?.feeStrategy === "organizer_absorbs" ? "organizer" : "buyer",
    });

    grossSales += face;
    netEarned += quote.organizerNet;
    ticketsSold += 1;

    // Only count a fee against the organiser when they are the one paying
    // it. On a buyer-pays event these are the buyer's costs and showing them
    // as deductions would make the organiser think they had been charged.
    if (quote.platformFeePaidBy === "organizer") platformFee += quote.platformFee;
    if (quote.processingFeePaidBy === "organizer") {
      processingFee += quote.processingFee;
    }
  }

  const payoutRows = await db
    .select({ netAmount: payouts.netAmount, status: payouts.status })
    .from(payouts)
    .where(eq(payouts.organizationId, organizationId));

  let paidOut = 0;
  let pending = 0;
  for (const row of payoutRows) {
    const amount = Number(row.netAmount);
    if (!Number.isFinite(amount)) continue;
    if (row.status === "paid") paidOut += amount;
    // `processing` counts as pending: the money is committed and must not be
    // offered for a second withdrawal while it is in flight.
    else if (row.status === "pending" || row.status === "processing") {
      pending += amount;
    }
  }

  return {
    grossSales: round2(grossSales),
    platformFee: round2(platformFee),
    processingFee: round2(processingFee),
    refunded: round2(refunded),
    netEarned: round2(netEarned),
    paidOut: round2(paidOut),
    pending: round2(pending),
    // Never negative: an over-payout is a conversation, not a number to
    // show an organiser as though they owed it back.
    available: Math.max(0, round2(netEarned - paidOut - pending)),
    ticketsSold,
  };
}
