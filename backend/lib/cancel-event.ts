import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { events, orders, payments, refunds, tickets } from "@/db/schema";
import { quoteCancellationRefund } from "@/lib/fees";
import { sendEventCancelled } from "@/lib/email-service";
import { appUrl } from "@/lib/app-url";
import {
  initiateMonnifyRefund,
  monnifyFeeFromStoredResponse,
  storedMonnifyTransaction,
} from "@/lib/monnify";
import { paystackFeeFromStoredResponse } from "@/lib/paystack";
import { updateMonnifyRefundStatus } from "@/lib/finalize-order";

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
  /** Actual provider fees, which are not returned with an event cancellation. */
  processingLost: number;
  /** Orders with no usable payment reference — these need manual handling. */
  unrefundable: number;
};

/** Money owed if this event were called off, without changing anything. */
export async function cancellationBill(eventId: string): Promise<CancellationBill> {
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
    where: and(
      inArray(
        payments.orderId,
        paid.map((o) => o.id)
      ),
      eq(payments.status, "success")
    ),
  });
  const paymentByOrder = new Map(refs.map((p) => [p.orderId, p]));

  for (const order of paid) {
    // subtotal is the face value — what the tickets cost before anyone's fee
    // was added. Using `total` here would refund the buyer their own card
    // charge, which we never received and cannot return.
    const quote = quoteCancellationRefund(
      Number(order.subtotal),
      order.platformFeePaidBy
    );
    bill.buyerRefundTotal += quote.buyerRefund;
    bill.platformFeeForgone += quote.organizerRefunded;
    const payment = paymentByOrder.get(order.id);
    if (!payment?.providerReference) {
      bill.unrefundable += 1;
      continue;
    }
    if (payment.provider === "monnify") {
      const transaction = storedMonnifyTransaction(payment.rawProviderResponse);
      bill.processingLost +=
        monnifyFeeFromStoredResponse(payment.rawProviderResponse) ?? 0;
      if (
        transaction?.paymentMethod !== "ACCOUNT_TRANSFER" ||
        quote.buyerRefund < 100
      ) {
        bill.unrefundable += 1;
      }
    } else if (payment.provider === "paystack") {
      bill.processingLost +=
        paystackFeeFromStoredResponse(payment.rawProviderResponse) ?? 0;
    }
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
      order.platformFeePaidBy
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
  pending: number;
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

  const result: RefundAllResult = {
    refunded: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  if (!event || paid.length === 0) return result;

  for (const order of paid) {
    const already = await db.query.refunds.findFirst({
      where: eq(refunds.orderId, order.id),
    });
    if (already?.status === "pending") {
      result.pending += 1;
      continue;
    }
    if (already?.status === "completed") {
      result.skipped += 1;
      continue;
    }

    const payment = await db.query.payments.findFirst({
      where: eq(payments.orderId, order.id),
    });
    if (!payment?.providerReference) {
      result.failed += 1;
      continue;
    }

    const quote = quoteCancellationRefund(
      Number(order.subtotal),
      order.platformFeePaidBy
    );

    try {
      if (payment.provider === "monnify") {
        const transaction = storedMonnifyTransaction(payment.rawProviderResponse);
        const ticketsForOrder = await db.query.tickets.findMany({
          where: eq(tickets.orderId, order.id),
        });
        if (
          !transaction?.transactionReference ||
          transaction.paymentMethod !== "ACCOUNT_TRANSFER" ||
          quote.buyerRefund < 100 ||
          !ticketsForOrder[0]
        ) {
          result.failed += 1;
          continue;
        }

        const refundReference = `WD-RF-${randomUUID()}`;
        const [refundRecord] = await db
          .insert(refunds)
          .values({
            ticketId: ticketsForOrder[0].id,
            orderId: order.id,
            eventId,
            amount: quote.buyerRefund.toFixed(2),
            reason: "Event cancelled",
            providerReference: refundReference,
            status: "pending",
            refundedBy: actorId,
          })
          .returning({ id: refunds.id });
        if (!refundRecord) {
          throw new Error(`Could not record the refund for order ${order.id}.`);
        }

        const response = await initiateMonnifyRefund({
          transactionReference: transaction.transactionReference,
          refundReference,
          refundAmount: quote.buyerRefund,
          refundReason: `${event.title} cancelled`.slice(0, 64),
          customerNote: "Event cancelled",
        });
        await db
          .update(refunds)
          .set({ providerResponse: response.raw })
          .where(eq(refunds.id, refundRecord.id));

        if (response.refund.refundStatus === "FAILED") {
          await updateMonnifyRefundStatus(
            refundReference,
            "failed",
            response.raw
          );
          result.failed += 1;
        } else if (response.refund.refundStatus === "COMPLETED") {
          await updateMonnifyRefundStatus(
            refundReference,
            "completed",
            response.raw
          );
          result.refunded += 1;
          result.total += quote.buyerRefund;
        } else if (response.refund.refundStatus === "PENDING") {
          result.pending += 1;
        } else {
          throw new Error(
            `Monnify returned unknown refund status for order ${order.id}.`
          );
        }
        continue;
      }

      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (payment.provider !== "paystack" || !secret) {
        result.failed += 1;
        continue;
      }
      const orderTickets = await db.query.tickets.findMany({
        where: eq(tickets.orderId, order.id),
      });
      const ticket = orderTickets[0];
      if (!ticket) {
        result.failed += 1;
        continue;
      }
      const refundReference = `WD-RF-${randomUUID()}`;
      const [refundRecord] = await db
        .insert(refunds)
        .values({
          ticketId: ticket.id,
          orderId: order.id,
          eventId,
          amount: quote.buyerRefund.toFixed(2),
          reason: "Event cancelled",
          providerReference: refundReference,
          status: "pending",
          refundedBy: actorId,
        })
        .returning({ id: refunds.id });
      if (!refundRecord) {
        throw new Error(`Could not record the refund for order ${order.id}.`);
      }

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
        await db
          .update(refunds)
          .set({ status: "failed", providerResponse: body })
          .where(
            and(eq(refunds.id, refundRecord.id), eq(refunds.status, "pending"))
          );
        result.failed += 1;
        console.error(`Refund failed for order ${order.id}:`, body);
        continue;
      }

      await db
        .update(refunds)
        .set({ providerResponse: body })
        .where(eq(refunds.id, refundRecord.id));
      result.pending += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Refund threw for order ${order.id}:`, error);
    }
  }

  result.total = Math.round(result.total * 100) / 100;
  return result;
}
