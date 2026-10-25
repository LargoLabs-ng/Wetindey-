import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, refunds, tickets } from "@/db/schema";
import { requireEventCapability, isUuid } from "@/lib/authz";
import { releaseRefundedTicket } from "@/lib/inventory";
import { naira, quoteRefund } from "@/lib/fees";
import { sendEmailWithResult } from "@/lib/email-service";
import { randomUUID } from "node:crypto";
import { storedMonnifyTransaction, initiateMonnifyRefund } from "@/lib/monnify";
import { updateMonnifyRefundStatus } from "@/lib/finalize-order";

type RouteContext = { params: Promise<{ ticketId: string }> };

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POST /api/tickets/:ticketId/refund
 *
 * Refunds one ticket. The buyer gets back their share of what the order was
 * charged — face value plus the platform fee on it. Monnify refunds are
 * currently supported only for account-transfer transactions and complete
 * asynchronously; tickets stay active until Monnify confirms the refund.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { ticketId } = await context.params;
    if (!isUuid(ticketId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .limit(1);

    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const access = await requireEventCapability(ticket.eventId, "refund:issue");
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      );
    }

    if (ticket.status === "refunded") {
      return NextResponse.json(
        { error: "That ticket has already been refunded." },
        { status: 409 }
      );
    }
    if (ticket.status === "pending") {
      return NextResponse.json(
        { error: "That ticket was never paid for, so there is nothing to refund." },
        { status: 409 }
      );
    }

    const pendingRefund = await db.query.refunds.findFirst({
      where: and(
        eq(refunds.ticketId, ticket.id),
        eq(refunds.status, "pending")
      ),
    });
    if (pendingRefund) {
      return NextResponse.json(
        { error: "A refund for this ticket is already being processed." },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, ticket.orderId))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // One ticket's face value, and what a refund actually returns.
    const siblings = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.orderId, order.id));
    const shareCount = Math.max(1, siblings.length);
    const faceValue = round2(Number(order.subtotal) / shareCount);

    // A refunded sale costs the platform half its usual cut, not all of it.
    // If the buyer paid our fee, the returned half goes back to them with
    // the ticket price; if the organizer paid it, they are charged half.
    const refund = quoteRefund(faceValue, order.platformFeePaidBy);
    const amount = refund.buyerRefund;
    const serviceFeeKept = refund.platformKeeps;

    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, "success")))
      .limit(1);
    if (!payment) {
      return NextResponse.json(
        { error: "No completed payment was found for this order." },
        { status: 409 }
      );
    }

    let providerReference: string | null = null;
    let providerResponse: unknown = null;
    let monnifyCompleted = false;
    let paystackPending = false;

    if (payment?.provider === "monnify") {
      if (!payment.providerReference) {
        return NextResponse.json(
          { error: "The Monnify payment reference is unavailable." },
          { status: 409 }
        );
      }
      const transaction = storedMonnifyTransaction(payment.rawProviderResponse);
      if (!transaction?.transactionReference) {
        return NextResponse.json(
          { error: "Verified Monnify transaction details are unavailable." },
          { status: 409 }
        );
      }
      if (transaction.paymentMethod !== "ACCOUNT_TRANSFER") {
        return NextResponse.json(
          {
            error:
              "Monnify currently supports API refunds only for account-transfer payments. Please arrange this refund manually.",
          },
          { status: 422 }
        );
      }
      if (amount < 100) {
        return NextResponse.json(
          {
            error:
              "Monnify refunds must be at least ₦100. Please arrange this refund manually.",
          },
          { status: 422 }
        );
      }

      providerReference = `WD-RF-${randomUUID()}`;
      const [refundRecord] = await db
        .insert(refunds)
        .values({
          ticketId: ticket.id,
          orderId: order.id,
          eventId: ticket.eventId,
          amount: amount.toFixed(2),
          reason: reason ?? null,
          providerReference,
          status: "pending",
          refundedBy: access.userId,
        })
        .returning({ id: refunds.id });

      if (!refundRecord) {
        throw new Error("Could not record the pending refund.");
      }

      const result = await initiateMonnifyRefund({
        transactionReference: transaction.transactionReference,
        refundReference: providerReference,
        refundAmount: amount,
        refundReason: (reason || `Ticket refund: ${access.event.title}`).slice(
          0,
          64
        ),
        customerNote: "Ticket refund",
      });
      providerResponse = result.raw;

      if (result.refund.refundStatus === "FAILED") {
        await updateMonnifyRefundStatus(
          providerReference,
          "failed",
          providerResponse
        );
        return NextResponse.json(
          { error: "Monnify could not initiate the refund." },
          { status: 502 }
        );
      }

      if (result.refund.refundStatus === "PENDING") {
        await db
          .update(refunds)
          .set({ providerResponse })
          .where(eq(refunds.id, refundRecord.id));
        return NextResponse.json({
          success: true,
          pending: true,
          amount,
          serviceFeeKept,
        });
      }

      if (result.refund.refundStatus !== "COMPLETED") {
        throw new Error(
          `Monnify returned an unsupported refund status: ${result.refund.refundStatus}`
        );
      }

      await updateMonnifyRefundStatus(
        providerReference,
        "completed",
        providerResponse
      );
      monnifyCompleted = true;
    } else if (payment?.provider === "paystack") {
      if (!payment.providerReference) {
        return NextResponse.json(
          { error: "The legacy payment reference is unavailable." },
          { status: 409 }
        );
      }
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        return NextResponse.json(
          { error: "Paystack is not configured for legacy refunds." },
          { status: 503 }
        );
      }
      providerReference = `WD-RF-${randomUUID()}`;
      const [refundRecord] = await db
        .insert(refunds)
        .values({
          ticketId: ticket.id,
          orderId: order.id,
          eventId: ticket.eventId,
          amount: amount.toFixed(2),
          reason: reason ?? null,
          providerReference,
          status: "pending",
          refundedBy: access.userId,
        })
        .returning({ id: refunds.id });
      if (!refundRecord) {
        throw new Error("Could not record the pending refund.");
      }

      const response = await fetch("https://api.paystack.co/refund", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction: payment.providerReference,
          amount: Math.round(amount * 100),
          merchant_note: reason || `Refund for ${access.event.title}`,
        }),
      });

      providerResponse = await response.json().catch(() => null);

      if (!response.ok) {
        await db
          .update(refunds)
          .set({ status: "failed", providerResponse })
          .where(
            and(eq(refunds.id, refundRecord.id), eq(refunds.status, "pending"))
          );
        const message =
          (providerResponse as { message?: string })?.message ??
          `Paystack returned ${response.status}`;
        return NextResponse.json(
          { error: `Paystack refused the refund: ${message}` },
          { status: 502 }
        );
      }

      await db
        .update(refunds)
        .set({ providerResponse })
        .where(eq(refunds.id, refundRecord.id));
      paystackPending = true;
    } else {
      return NextResponse.json(
        {
          error:
            "This payment provider cannot issue refunds automatically. Send the refund manually before changing the ticket status.",
        },
        { status: 409 }
      );
    }

    if (paystackPending) {
      return NextResponse.json({
        success: true,
        pending: true,
        amount,
        serviceFeeKept,
      });
    }

    if (!monnifyCompleted) {
      // Record first, then flip state, so a refund can never be invisible.
      await db.insert(refunds).values({
        ticketId: ticket.id,
        orderId: order.id,
        eventId: ticket.eventId,
        amount: amount.toFixed(2),
        reason: reason ?? null,
        providerReference,
        providerResponse: providerResponse ?? null,
        refundedBy: access.userId,
      });

      await db
        .update(tickets)
        .set({ status: "refunded" })
        .where(eq(tickets.id, ticket.id));

      await releaseRefundedTicket(ticket.ticketTypeId);

      // If nothing live is left on the order, the order itself is refunded.
      const remaining = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(eq(tickets.orderId, order.id), eq(tickets.status, "valid"))
        );
      const checkedIn = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(eq(tickets.orderId, order.id), eq(tickets.status, "checked_in"))
        );

      if (remaining.length === 0 && checkedIn.length === 0) {
        await db
          .update(orders)
          .set({ status: "refunded" })
          .where(eq(orders.id, order.id));
      }
    }

    const emailed = await sendEmailWithResult({
      to: ticket.attendeeEmail,
      subject: `Your ticket for ${access.event.title} has been refunded`,
      html: `
        <h2>Refund issued</h2>
        <p>Hi ${ticket.attendeeName},</p>
        <p>
          Your ticket for <strong>${access.event.title}</strong> has been
          refunded. ${naira(amount)} is on its way back to your original
          payment method — banks usually take a few working days.
        </p>
        ${reason ? `<p>Reason given: ${reason}</p>` : ""}
        <p>This ticket will no longer be admitted at the door.</p>
      `,
    });

    return NextResponse.json({
      success: true,
      amount,
      serviceFeeKept,
      // Monnify processing fees are not represented as returned by the refund API.
      processingFeeReturned: false,
      emailSent: emailed.ok,
      emailError: emailed.ok ? undefined : emailed.error,
    });
  } catch (error) {
    console.error("Refund failed:", error);
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
