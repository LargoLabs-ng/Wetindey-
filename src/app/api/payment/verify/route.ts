import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { payments } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get('reference');

    if (!reference) {
      return NextResponse.json(
        { error: 'Missing reference parameter' },
        { status: 400 }
      );
    }

    const payment = await db.query.payments.findFirst({
      where: eq(payments.providerReference, reference),
      with: {
        order: {
          with: {
            event: true,
            tickets: true,
          },
        },
      },
    });

    if (!payment) {
      return NextResponse.json(
        { status: 'failed', message: 'Payment not found' },
        { status: 404 }
      );
    }

    const order = payment.order;

    if (payment.status === 'success') {
      return NextResponse.json({
        status: 'success',
        orderId: order.id,
        eventTitle: order.event.title,
        // Inside the success branch on purpose, and nowhere else in this
        // file. The whole promise of this field is that it is visible only to
        // somebody who paid — putting it in the pending or failed response
        // would hand a WhatsApp group link to anyone who abandoned checkout.
        afterPurchase:
          order.event.afterPurchaseNote || order.event.afterPurchaseUrl
            ? {
                note: order.event.afterPurchaseNote,
                url: order.event.afterPurchaseUrl,
              }
            : null,
        tickets: order.tickets.map((ticket) => ({
          id: ticket.id,
          qrToken: ticket.qrToken,
          attendeeName: ticket.attendeeName,
          attendeeEmail: ticket.attendeeEmail,
        })),
      });
    }

    if (payment.status === 'pending' || payment.status === 'initialized') {
      return NextResponse.json({
        status: 'pending',
        message: 'Payment is being processed. Please wait...',
        orderId: order.id,
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
      message: 'Payment status unknown. Please check your email.',
      orderId: order.id,
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    return NextResponse.json(
      { error: 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
