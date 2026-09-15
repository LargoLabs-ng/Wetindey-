import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from "@/lib/app-url";
import { quoteOrder } from "@/lib/fees";
import { db } from '@/db';
import { events, orders, tickets, payments, ticketTypes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  availableQuantity,
  releaseExpiredReservations,
  releaseOrderReservation,
} from '@/lib/inventory';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;


interface CreateOrderRequest {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyerEmail: string;
  buyerPhone: string;
  attendees: Array<{ name: string; email: string }>;
}

function generateQRToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest) {
  try {
    // Hand back inventory from checkouts that were abandoned past their
    // 15-minute hold, before we decide what's available.
    await releaseExpiredReservations();

    const body: CreateOrderRequest = await request.json();
    const { eventId, ticketTypeId, quantity, buyerEmail, buyerPhone, attendees } = body;

    if (!eventId || !ticketTypeId || !quantity || !buyerEmail || !buyerPhone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (attendees.length !== quantity) {
      return NextResponse.json(
        { error: 'Attendee count must match quantity' },
        { status: 400 }
      );
    }

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.status !== 'published') {
      return NextResponse.json(
        { error: 'Event is not available for ticket sales' },
        { status: 400 }
      );
    }

    const ticketType = await db.query.ticketTypes.findFirst({
      where: eq(ticketTypes.id, ticketTypeId),
    });

    if (!ticketType) {
      return NextResponse.json(
        { error: 'Ticket type not found' },
        { status: 404 }
      );
    }

    const available = availableQuantity(ticketType);
    if (available < quantity) {
      return NextResponse.json(
        { error: `Only ${available} tickets available` },
        { status: 400 }
      );
    }

    // The event decides who carries Paystack's fee. `buyerTotal` is what the
    // event page quoted and what we record; `paystackAmount` is what the
    // transaction is initialized for, which differs when the organizer
    // absorbs the fee (the account adds its cut on top of whatever we send).
    const quote = quoteOrder(
      parseFloat(ticketType.price) * quantity,
      event.feeStrategy
    );
    const subtotal = quote.subtotal;
    const fees = quote.platformFee;
    const total = quote.buyerTotal;

    const [order] = await db
      .insert(orders)
      .values({
        eventId,
        buyerId: null,
        email: buyerEmail,
        phone: buyerPhone,
        subtotal: subtotal.toString(),
        fees: fees.toString(),
        total: total.toString(),
        status: 'pending' as const,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })
      .returning();

    if (!order) {
      return NextResponse.json(
        { error: 'Failed to create order' },
        { status: 500 }
      );
    }

    const ticketInserts = attendees.map((attendee) => ({
      orderId: order.id,
      eventId,
      ticketTypeId,
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      qrToken: generateQRToken(),
      status: 'pending' as const,
    }));

    await db.insert(tickets).values(ticketInserts);

    await db
      .update(ticketTypes)
      .set({
        quantityReserved: ticketType.quantityReserved + quantity,
      })
      .where(eq(ticketTypes.id, ticketTypeId));

    // Any failure past this point must give the reserved inventory back,
    // including a thrown Paystack error — previously a throw skipped the
    // rollback entirely and the tickets stayed reserved forever.
    let paystackResponse;
    try {
      paystackResponse = await initializePaystackPayment({
        amount: Math.round(quote.paystackAmount * 100),
        email: buyerEmail,
        reference: `TB-${order.id.slice(0, 8)}-${Date.now()}`,
        orderId: order.id,
        eventTitle: event.title,
        ticketCount: quantity,
      });
    } catch (paymentError) {
      await releaseOrderReservation(order.id);
      await db.delete(orders).where(eq(orders.id, order.id));
      throw paymentError;
    }

    if (!paystackResponse.status) {
      await releaseOrderReservation(order.id);
      await db.delete(orders).where(eq(orders.id, order.id));
      throw new Error('Failed to initialize payment');
    }

    await db.insert(payments).values({
      orderId: order.id,
      provider: 'paystack',
      providerReference: paystackResponse.data.reference,
      amount: quote.paystackAmount.toString(),
      status: 'initialized',
      rawProviderResponse: paystackResponse.data,
    });

    return NextResponse.json({
      orderId: order.id,
      paymentUrl: paystackResponse.data.authorization_url,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create order' },
      { status: 500 }
    );
  }
}

async function initializePaystackPayment(params: {
  amount: number;
  email: string;
  reference: string;
  orderId: string;
  eventTitle: string;
  ticketCount: number;
}) {
  const url = 'https://api.paystack.co/transaction/initialize';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amount,
      email: params.email,
      reference: params.reference,
      metadata: {
        orderId: params.orderId,
        eventTitle: params.eventTitle,
        ticketCount: params.ticketCount,
      },
      callback_url: appUrl('/payment/callback'),
    }),
  });

  if (!response.ok) {
    throw new Error(`Paystack API error: ${response.statusText}`);
  }

  return response.json();
}
