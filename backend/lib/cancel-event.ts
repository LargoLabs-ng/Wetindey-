import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, payments, refunds, tickets } from "@/db/schema";
import { quoteCancellationRefund } from "@/lib/fees";
import { sendEventCancelled } from "@/lib/email-service";
import { appUrl } from "@/lib/app-url";

/**
 * Calling off an event.
 *
 * Split into two deliberate halves, because they carry very different risk:
 *
 *   cancelEvent()      voids tickets and tells everyone. Reversible-ish, and
 *                      urgent — people need to know before they travel.
 *   refundEverybody()  moves money. Irreversible, and can wait ten seconds
 *                      for a human to read the total and say yes.
 *
 * Doing both on one click would mean a mis-click on a sold-out event
 * refunding hundreds of thousands of naira with no way back. Doing neither
 * automatically would mean attendees turning up to a locked hall. So: tell
 * people immediately, move money on confirmation.
 */

export type CancellationBill = {
  orders: number;
  tickets: number;
  /** Total going back to buyers. */
  buyerRefundTotal: number;
  /** Our cut on this event, all of which we give up. */
  platformFeeForgone: number;
  /** Paystack's charge, which nobody gets back. */
  processingLost: number;
  /** Orders with no usable payment reference — these need manual handling. */
  unrefundable: number;
};

/** Money owed if this event were called off, without changing anything. */
export async function cancellationBill(eventId: string): Promise<CancellationBill> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });

  const paid = await db.query.orders.findMany({
    where: and(eq(orders.eventId, eventId), eq(orders.status, "paid")),
  });

  const bill: CancellationBill = {
    orders: paid.length,
    tickets: 0,
    buyerRefundTotal: 0,
    platformFeeForgone: 0,
    processingLost: 0,
    unrefundable: 0,
  };

  if (paid.length === 0) return bill;

  const live = await db.query.tickets.findMany({
    where: and(
      eq(tickets.eventId, eventId),
      inArray(tickets.status, ["valid", "checked_in"])
    ),
  });
  bill.tickets = live.length;

  const refs = await db.query.payments.findMany({
    where: inArray(
      payments.orderId,
      paid.map((o) => o.id)
    ),
  });
  const refByOrder = new Map(refs.map((p) => [p.orderId, p.providerReference]));

  for (const order of paid) {
    // subtotal is the face value — what the tickets cost before anyone's fee
    // was added. Using `total` here would refund the buyer their own card
    // charge, which we never received and cannot return.
    const quote = quoteCancellationRefund(
      Number(order.subtotal),
      event?.platformFeePaidBy ?? "organizer"
    );
    bill.buyerRefundTotal += quote.buyerRefund;
    bill.platformFeeForgone += quote.organizerRefunded;
    bill.processingLost += quote.processingLost;
    if (!refByOrder.get(order.id)) bill.unrefundable += 1;
  }

  bill.buyerRefundTotal = Math.round(bill.buyerRefundTotal * 100) / 100;
  bill.platformFeeForgone = Math.round(bill.platformFeeForgone * 100) / 100;
  bill.processingLost = Math.round(bill.processingLost * 100) / 100;

  return bill;
}

export type CancelResult = {
  ticketsVoided: number;
  buyersNotified: number;
  notifyFailures: number;
  bill: CancellationBill;
};

/**
 * Void the event's tickets and tell every buyer. No money moves here.
 */
export async function cancelEvent(
  eventId: string,
  reason: string | null
): Promise<CancelResult> {
  const bill = await cancellationBill(eventId);

  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) {
    return { ticketsVoided: 0, buyersNotified: 0, notifyFailures: 0, bill };
  }

  await db
    .update(events)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(events.id, eventId));

  // checked_in included on purpose. If an event is called off midway, the
  // people already through the door hold tickets that are no longer good for
  // anything, and leaving them "checked_in" would keep them out of the
  // refund count.
  const voided = await db
    .update(tickets)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(tickets.eventId, eventId),
        inArray(tickets.status, ["valid", "checked_in", "pending"])
      )
    )
    .returning({ id: tickets.id });

  // One email per buyer, not per ticket: somebody who bought five tickets
  // for their friends gets told once.
  const paid = await db.query.orders.findMany({
    where: and(eq(orders.eventId, eventId), eq(orders.status, "paid")),
  });

  const byEmail = new Map<string, { total: number }>();
  for (const order of paid) {
    const current = byEmail.get(order.email) ?? { total: 0 };
    const quote = quoteCancellationRefund(
      Number(order.subtotal),
      event.platformFeePaidBy
    );
    current.total += quote.buyerRefund;
    byEmail.set(order.email, current);
  }

  let buyersNotified = 0;
  let notifyFailures = 0;

  for (const [email, info] of byEmail) {
    try {
      const sent = await sendEventCancelled({
        to: email,
        eventTitle: event.title,
        eventDate: new Date(event.startDatetime).toLocaleDateString("en-NG", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        reason,
        refundAmount: Math.round(info.total * 100) / 100,
        discoverUrl: appUrl("/discover"),
      });
      if (sent) buyersNotified += 1;
      else notifyFailures += 1;
    } catch (error) {
      notifyFailures += 1;
      console.error(`Cancellation email failed for ${email}:`, error);
    }
  }

  return {
    ticketsVoided: voided.length,
    buyersNotified,
    notifyFailures,
    bill,
  };
}

export type RefundAllResult = {
  refunded: number;
  failed: number;
  skipped: number;
  total: number;
};

/**
 * Send everybody their money back. Only ever called after an explicit
 * confirmation from a human who has seen the total.
 *
 * Each order is refunded independently and a failure on one does not stop
 * the rest — a single dead reference must not leave forty people unrefunded.
 * Re-running is safe: an order with a refunds row is skipped.
 */
export async function refundEverybody(
  eventId: string,
  actorId: string
): Promise<RefundAllResult> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  const paid = await db.query.orders.findMany({
    where: and(eq(orders.eventId, eventId), eq(orders.status, "paid")),
  });

  const result: RefundAllResult = { refunded: 0, failed: 0, skipped: 0, total: 0 };
  if (!event || paid.length === 0) return result;

  const secret = process.env.PAYSTACK_SECRET_KEY;

  for (const order of paid) {
    const already = await db.query.refunds.findFirst({
      where: eq(refunds.orderId, order.id),
    });
    if (already) {
      result.skipped += 1;
      continue;
    }

    const payment = await db.query.payments.findFirst({
      where: eq(payments.orderId, order.id),
    });
    if (!payment?.providerReference || !secret) {
      result.failed += 1;
      continue;
    }

    const quote = quoteCancellationRefund(
      Number(order.subtotal),
      event.platformFeePaidBy
    );

    try {
      const response = await fetch("https://api.paystack.co/refund", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction: payment.providerReference,
          amount: Math.round(quote.buyerRefund * 100),
          merchant_note: `${event.title} was cancelled`,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        result.failed += 1;
        console.error(`Refund failed for order ${order.id}:`, body);
        continue;
      }

      const orderTickets = await db.query.tickets.findMany({
        where: eq(tickets.orderId, order.id),
      });

      // Written after the money moves, never before: a refunds row the bank
      // never honoured is worse than no row, because the retry is skipped.
      await db.insert(refunds).values({
        ticketId: orderTickets[0]?.id ?? "",
        orderId: order.id,
        eventId,
        amount: quote.buyerRefund.toFixed(2),
        reason: "Event cancelled",
        providerReference: body?.data?.reference ?? null,
        providerResponse: body ?? null,
        refundedBy: actorId,
      });

      await db
        .update(orders)
        .set({ status: "refunded" })
        .where(eq(orders.id, order.id));

      result.refunded += 1;
      result.total += quote.buyerRefund;
    } catch (error) {
      result.failed += 1;
      console.error(`Refund threw for order ${order.id}:`, error);
    }
  }

  result.total = Math.round(result.total * 100) / 100;
  return result;
}
