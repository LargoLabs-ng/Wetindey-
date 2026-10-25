import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, promoCodes, refunds, tickets } from "@/db/schema";
import {
  confirmOrderInventory,
  releaseOrderReservation,
  releaseRefundedTicket,
} from "@/lib/inventory";
import { sendTicketsForOrder } from "@/lib/ticket-email";

/**
 * Turn a successful payment into tickets.
 *
 * This used to live inside the Paystack webhook, which made the webhook the
 * only thing capable of completing a purchase. If it was delayed, dropped, or
 * simply could not reach us — a local dev server, a deploy mid-flight, a
 * tunnel that expired — the buyer's money was taken and their ticket never
 * existed, with nothing to retry it.
 *
 * Now both the webhook and the buyer's own return to the site call this, and
 * whichever arrives first wins. The other becomes a no-op.
 */
export type FinalizeResult =
  | { ok: true; orderId: string; alreadyDone: boolean; emailSent: boolean }
  | { ok: false; reason: "unknown-reference" };

export async function finalizePaidOrder(reference: string): Promise<FinalizeResult> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, reference),
    with: { order: true },
  });

  if (!payment || !payment.order) return { ok: false, reason: "unknown-reference" };
  const orderId = payment.order.id;

  // Claim with the write itself. Two callers racing — webhook and browser, or
  // a duplicate provider retry — can both read 'initialized' before either writes, and
  // would then both issue tickets and both email the buyer. Putting the status
  // in the WHERE means exactly one caller can claim it.
  const claimed = await db
    .update(payments)
    .set({ status: "success", paidAt: new Date() })
    .where(and(eq(payments.id, payment.id), ne(payments.status, "success")))
    .returning({ id: payments.id });

  if (claimed.length === 0) {
    return { ok: true, orderId, alreadyDone: true, emailSent: false };
  }

  await db.update(orders).set({ status: "paid" }).where(eq(orders.id, orderId));
  await db.update(tickets).set({ status: "valid" }).where(eq(tickets.orderId, orderId));

  // Move this order's held inventory into the sold column.
  await confirmOrderInventory(orderId);

  await countPromoUse(orderId);

  // Best effort: a failed email must not undo a completed purchase. The buyer
  // can always retrieve the ticket from /tickets/recover.
  let emailSent = false;
  try {
    await sendTicketsForOrder(orderId);
    emailSent = true;
  } catch (error) {
    console.error(`Ticket email failed for order ${orderId}:`, error);
  }

  return { ok: true, orderId, alreadyDone: false, emailSent };
}

export async function finalizeFreeOrder(orderId: string): Promise<boolean> {
  const claimed = await db
    .update(orders)
    .set({ status: "paid" })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  if (claimed.length === 0) return false;

  await db.update(tickets).set({ status: "valid" }).where(eq(tickets.orderId, orderId));
  await confirmOrderInventory(orderId);
  await countPromoUse(orderId);
  try {
    await sendTicketsForOrder(orderId);
  } catch (error) {
    console.error(`Ticket email failed for free order ${orderId}:`, error);
  }
  return true;
}

/**
 * A charge that Paystack told us failed.
 *
 * Without this the order sits `pending` and its seats stay reserved until the
 * 15-minute sweep notices — so for a quarter of an hour after a card is
 * declined, an event can look sold out to everyone else because of a sale
 * that never happened. On a 50-seat freshers night with people buying at the
 * door, that is the difference between selling out and turning people away
 * for nothing.
 *
 * Deliberately refuses to touch an order that is already paid. Paystack can
 * deliver a `charge.failed` for a first attempt AFTER the `charge.success`
 * for the retry that worked, and a naive handler would cancel a ticket the
 * buyer had already been emailed.
 */
export async function failPendingOrder(reference: string): Promise<FinalizeResult> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, reference),
    with: { order: true },
  });

  if (!payment || !payment.order) return { ok: false, reason: "unknown-reference" };
  const orderId = payment.order.id;

  // Same atomic-claim shape as the success path: the status goes in the
  // WHERE, so a duplicate delivery claims nothing and does nothing. The
  // `ne success` is what protects a paid order from a late failure event.
  const claimed = await db
    .update(payments)
    .set({ status: "failed" })
    .where(
      and(
        eq(payments.id, payment.id),
        ne(payments.status, "success"),
        ne(payments.status, "failed")
      )
    )
    .returning({ id: payments.id });

  if (claimed.length === 0) {
    return { ok: true, orderId, alreadyDone: true, emailSent: false };
  }

  // Belt and braces: even with the payment claimed, only unwind an order
  // that is still pending. An order already marked paid by the other path
  // keeps its tickets.
  const cancelled = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
    .returning({ id: orders.id });

  if (cancelled.length === 0) {
    return { ok: true, orderId, alreadyDone: true, emailSent: false };
  }

  await db
    .update(tickets)
    .set({ status: "cancelled" })
    .where(and(eq(tickets.orderId, orderId), eq(tickets.status, "pending")));

  // Give the seats back now rather than in fifteen minutes.
  await releaseOrderReservation(orderId);

  return { ok: true, orderId, alreadyDone: false, emailSent: false };
}

export type ExternalRefundResult =
  | { ok: true; orderId: string; full: boolean; alreadyRecorded: boolean }
  | { ok: false; reason: "unknown-reference" | "no-amount" };

export async function updateMonnifyRefundStatus(
  refundReference: string,
  status: "completed" | "failed",
  raw: unknown
): Promise<{ found: boolean; alreadyProcessed: boolean }> {
  const refund = await db.query.refunds.findFirst({
    where: eq(refunds.providerReference, refundReference),
  });
  if (!refund) return { found: false, alreadyProcessed: false };

  const claimed = await db
    .update(refunds)
    .set({ status, providerResponse: raw })
    .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending")))
    .returning({ id: refunds.id });
  if (claimed.length === 0) {
    return { found: true, alreadyProcessed: true };
  }
  if (status === "failed") {
    return { found: true, alreadyProcessed: false };
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, refund.ticketId))
    .limit(1);
  if (ticket && ticket.status !== "refunded" && ticket.status !== "cancelled") {
    await db
      .update(tickets)
      .set({ status: "refunded" })
      .where(eq(tickets.id, ticket.id));
    await releaseRefundedTicket(ticket.ticketTypeId);
  }

  const remaining = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.orderId, refund.orderId),
        inArray(tickets.status, ["valid", "checked_in"])
      )
    );
  if (remaining.length === 0) {
    await db
      .update(orders)
      .set({ status: "refunded" })
      .where(eq(orders.id, refund.orderId));
  }

  return { found: true, alreadyProcessed: false };
}

/**
 * A refund that happened at Paystack rather than through this app.
 *
 * Someone refunding from the Paystack dashboard is a normal thing to do and
 * our records knew nothing about it: the ticket stayed valid, the seat stayed
 * sold, and the buyer could still walk through the gate with a QR code for
 * money they no longer had. This closes that gap.
 *
 * Partial refunds are recorded but change nothing else. A ticket is valid or
 * it isn't; there is no half-admitted. Someone refunding part of an order
 * means something specific that only they know, so this writes it down and
 * leaves the tickets alone rather than guessing which seat to void.
 */
export async function recordExternalRefund(data: {
  reference: string;
  /** Kobo, as Paystack sends it. */
  amountMinor?: number;
  providerReference?: string;
  raw?: unknown;
}): Promise<ExternalRefundResult> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, data.reference),
    with: { order: true },
  });

  if (
    !payment ||
    payment.provider !== "paystack" ||
    !payment.order
  ) {
    return { ok: false, reason: "unknown-reference" };
  }
  if (typeof data.amountMinor !== "number") return { ok: false, reason: "no-amount" };

  const order = payment.order;
  const amount = data.amountMinor / 100;

  // Our own refund flow writes a refunds row before it ever calls Paystack,
  // so the webhook that follows finds it here and stops. Without this check
  // every refund we issue would be recorded twice — once by us, once by the
  // echo of our own API call.
  const existingRefunds = await db.query.refunds.findMany({
    where: eq(refunds.orderId, order.id),
  });
  const pendingRefund = existingRefunds.find(
    (refund) =>
      refund.status === "pending" &&
      Math.abs(Number(refund.amount) - amount) < 0.005
  );
  if (pendingRefund?.providerReference) {
    await updateMonnifyRefundStatus(
      pendingRefund.providerReference,
      "completed",
      data.raw
    );
    const full = amount >= Number(payment.amount) - 0.005;
    return { ok: true, orderId: order.id, full, alreadyRecorded: false };
  }
  if (existingRefunds.length > 0) {
    return { ok: true, orderId: order.id, full: false, alreadyRecorded: true };
  }

  // Half a kobo of tolerance, because comparing money that has been through
  // a currency conversion and back with === is how off-by-one-kobo bugs are
  // born.
  const paymentAmount = Number(payment.amount);
  const full =
    Number.isFinite(paymentAmount) && amount >= paymentAmount - 0.005;

  const orderTickets = await db.query.tickets.findMany({
    where: eq(tickets.orderId, order.id),
  });

  await db.insert(refunds).values({
    // The refunds table is per-ticket; for an order-wide refund made
    // elsewhere we attach it to the first ticket and let the amount and the
    // order id carry the real meaning.
    ticketId: orderTickets[0]?.id ?? "",
    orderId: order.id,
    eventId: order.eventId,
    amount: amount.toFixed(2),
    reason: full
      ? "Refunded at Paystack (full)"
      : "Partial refund at Paystack — tickets left untouched, needs review",
    providerReference: data.providerReference ?? null,
    providerResponse: (data.raw ?? null) as never,
    // No refundedBy: nobody in this system did it.
  });

  if (!full) {
    return { ok: true, orderId: order.id, full: false, alreadyRecorded: false };
  }

  await db.update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));

  for (const ticket of orderTickets) {
    if (ticket.status === "refunded" || ticket.status === "cancelled") continue;
    await db
      .update(tickets)
      .set({ status: "refunded" })
      .where(eq(tickets.id, ticket.id));
    await releaseRefundedTicket(ticket.ticketTypeId);
  }

  return { ok: true, orderId: order.id, full: true, alreadyRecorded: false };
}

export async function recordExternalRefundFailure(data: {
  reference: string;
  amountMinor?: number;
  raw?: unknown;
}): Promise<boolean> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.providerReference, data.reference),
  });
  if (!payment || payment.provider !== "paystack") return false;

  const pendingRefunds = await db.query.refunds.findMany({
    where: and(
      eq(refunds.orderId, payment.orderId),
      eq(refunds.status, "pending")
    ),
  });
  const amount =
    typeof data.amountMinor === "number" ? data.amountMinor / 100 : null;
  const refund = pendingRefunds.find(
    (item) =>
      amount === null || Math.abs(Number(item.amount) - amount) < 0.005
  );
  if (!refund?.providerReference) return false;

  await updateMonnifyRefundStatus(
    refund.providerReference,
    "failed",
    data.raw
  );
  return true;
}

/**
 * Count a promo code's use — here, on payment, not at checkout.
 *
 * The obvious place is when the order is created, and it is wrong. Most
 * checkouts that start do not finish: somebody opens checkout, changes their
 * mind, closes the tab. Counting those would mean a code limited to fifty
 * uses stops working after twenty real sales, and the organiser has no way to
 * see why.
 *
 * Counting on payment instead means `usedCount` says what an organiser
 * thinks it says — times this code actually got someone through the door —
 * and it matches the per-code revenue figures, which also count paid orders
 * only.
 *
 * The trade: two people paying in the same instant can both slip past a limit
 * that had one use left, so a "first 50" code might give away 51. That is a
 * far better failure than turning away paying customers, and the window is
 * the width of a hosted-checkout redirect.
 *
 * Runs inside the block that only executes once per order (the payment claim
 * above), so a webhook and a browser return racing each other cannot both
 * count it. Never throws: a miscount must not undo a completed purchase.
 */
async function countPromoUse(orderId: string): Promise<void> {
  try {
    const [order] = await db
      .select({ promoCodeId: orders.promoCodeId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order?.promoCodeId) return;

    await db
      .update(promoCodes)
      .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
      .where(eq(promoCodes.id, order.promoCodeId));
  } catch (error) {
    console.error(`Could not count promo use for order ${orderId}:`, error);
  }
}
