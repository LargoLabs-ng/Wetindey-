import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { payments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { finalizePaidOrder, isPaidAtPaystack } from '@/lib/finalize-order';

/**
 * GET /api/payment/verify?reference=…
 *
 * Called when the buyer lands back on the site. It asks PAYSTACK whether the
 * payment succeeded rather than only reading our own database — the previous
 * version did the latter, which meant it answered "pending" forever whenever
 * the webhook had not arrived, and the buyer's ticket never existed.
 *
 * Completing the order here as well as in the webhook is what makes a lost or
 * delayed webhook survivable: whoever gets there first finishes the job.
 */
export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get('reference');
    if (!reference) {
      return NextResponse.json({ error: 'Missing reference parameter' }, { status: 400 });
    }

    let payment = await db.query.payments.findFirst({
      where: eq(payments.providerReference, reference),
      with: { order: { with: { event: true, tickets: true } } },
    });

    if (!payment) {
      return NextResponse.json(
        { status: 'failed', message: 'Payment not found' },
        { status: 404 }
      );
    }

    // Not marked paid on our side yet — go and ask.
    if (payment.status !== 'success') {
      if (await isPaidAtPaystack(reference)) {
        await finalizePaidOrder(reference);
        payment = await db.query.payments.findFirst({
          where: eq(payments.providerReference, reference),
          with: { order: { with: { event: true, tickets: true } } },
        });
      }
    }

    if (!payment) {
      return NextResponse.json({ status: 'failed', message: 'Payment not found' }, { status: 404 });
    }

    const order = payment.order;

    if (payment.status === 'success') {
      return NextResponse.json({
        status: 'success',
        orderId: order.id,
        eventTitle: order.event.title,
        tickets: order.tickets.map((ticket) => ({
          id: ticket.id,
          qrToken: ticket.qrToken,
          attendeeName: ticket.attendeeName,
          attendeeEmail: ticket.attendeeEmail,
        })),
      });
    }

    if (payment.status === 'failed' || payment.status === 'abandoned') {
      return NextResponse.json({
        status: 'failed',
        message: 'Payment was not completed. Please try again.',
      });
    }

    return NextResponse.json({
      status: 'pending',
      message: 'We are still confirming this payment. Hold on a moment.',
      orderId: order.id,
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 });
  }
}
