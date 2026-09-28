import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from "@/lib/app-url";
import { quoteOrder } from "@/lib/fees";
import { db } from '@/db';
import {
  events,
  eventStaff,
  orders,
  promoCodes,
  registrationAnswers,
  registrationFields,
  tickets,
  payments,
  ticketTypes,
} from '@/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getSessionUserId } from '@/lib/authz';
import { validateAnswers, type RegistrationField } from '@/lib/registration';
import {
  applyPromo,
  checkCode,
  normalizeCode,
  type PromoCode,
} from '@/lib/promo';
import {
  availableQuantity,
  releaseExpiredReservations,
  releaseOrderReservation,
} from '@/lib/inventory';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * Turn a share code into the promoter who owns it, for this event.
 *
 * Resolved server-side from the raw code rather than letting the client send
 * a promoter id: a buyer's browser should not be able to name who gets
 * credit for a sale, and there is no endpoint that will tell an outsider who
 * promotes what.
 *
 * Every failure is silent and returns null. An unknown, stale or mistyped
 * code must never block a purchase — the worst case is a sale nobody gets
 * credited for, which is infinitely better than a student who cannot buy a
 * ticket because their friend's link had a typo in it.
 */
async function resolvePromoter(
  eventId: string,
  ref: unknown
): Promise<string | null> {
  if (typeof ref !== "string") return null;
  const code = ref.trim().toUpperCase();
  if (!code || code.length > 24) return null;

  try {
    const [row] = await db
      .select({ userId: eventStaff.userId, status: eventStaff.status })
      .from(eventStaff)
      .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.refCode, code)))
      .limit(1);

    // A promoter who has been removed from the event stops earning credit
    // from a link already out in the world.
    if (!row || row.status !== "active") return null;
    return row.userId ?? null;
  } catch {
    return null;
  }
}


interface CreateOrderRequest {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  buyerEmail: string;
  buyerPhone: string;
  attendees: Array<{ name: string; email: string }>;
  /**
   * A promoter's share code, straight off the link the buyer arrived on.
   * Optional and unverified here — resolvePromoter below decides whether it
   * means anything, and ignores it when it doesn't.
   */
  ref?: string;
  /**
   * Answers to the organiser's own extra questions. Shape is checked by
   * validateAnswers against the questions as they stand right now, not
   * trusted from the client.
   */
  answers?: unknown;
  /**
   * A code the buyer typed. Resolved and applied server-side — the price
   * this route calculates never trusts anything the page worked out.
   */
  promoCode?: string;
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
    const { eventId, ticketTypeId, quantity, buyerEmail, buyerPhone, attendees, ref } = body;
    const submittedAnswers = body.answers;
    const typedPromoCode = body.promoCode;

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

    // Checked before anything is reserved or inserted. A required question
    // left blank should cost a 400 and nothing else — not an order row and a
    // fifteen-minute inventory hold that has to be cleaned up afterwards.
    const fieldRows = await db
      .select()
      .from(registrationFields)
      .where(eq(registrationFields.eventId, eventId))
      .orderBy(asc(registrationFields.position));

    const checked = validateAnswers(
      fieldRows.map(
        (f): RegistrationField => ({
          id: f.id,
          label: f.label,
          kind: f.kind,
          options: f.options ?? [],
          required: f.required,
          position: f.position,
        })
      ),
      submittedAnswers
    );
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    const available = availableQuantity(ticketType);
    if (available < quantity) {
      return NextResponse.json(
        { error: `Only ${available} tickets available` },
        { status: 400 }
      );
    }

    /**
     * Resolve the typed code here, from the database, every time.
     *
     * The page has already previewed this against /promo-codes/check, but a
     * preview is a courtesy — the price that gets charged is calculated from
     * a fresh read, so a client that posts a made-up discount gets the full
     * price and no error.
     *
     * A code that no longer works is IGNORED rather than fatal. It expired
     * between the preview and the tap, or the organiser switched it off; in
     * either case the buyer wanted the ticket, and refusing the sale over a
     * discount they never had is the worse outcome. They pay the normal
     * price, which is what the page would have quoted without the code.
     */
    const typedCode = normalizeCode(typedPromoCode);
    let promo: PromoCode | null = null;
    if (typedCode) {
      const [row] = await db
        .select()
        .from(promoCodes)
        .where(
          and(
            eq(promoCodes.eventId, eventId),
            sql`upper(${promoCodes.code}) = ${typedCode}`
          )
        )
        .limit(1);

      if (row) {
        const candidate: PromoCode = {
          id: row.id,
          kind: row.kind,
          code: row.code,
          label: row.label,
          promoterName: row.promoterName,
          rate: Number(row.rate),
          usageLimit: row.usageLimit,
          usedCount: row.usedCount,
          active: row.active,
        };
        const check = checkCode(candidate);
        if (check.ok) promo = check.code;
      }
    }

    const faceValue = parseFloat(ticketType.price) * quantity;
    const effect = applyPromo(faceValue, promo);

    // The event decides who carries Paystack's fee. `buyerTotal` is what the
    // event page quoted and what we record; `paystackAmount` is what the
    // transaction is initialized for, which differs when the organizer
    // absorbs the fee (the account adds its cut on top of whatever we send).
    //
    // Quoted on the DISCOUNTED face value, so the fees follow the money
    // rather than the sticker — a buyer with 20% off pays 20% less card fee
    // too, and the organiser's cut is calculated on what actually came in.
    const quote = quoteOrder(effect.faceAfter, {
      platformFeePaidBy: event.platformFeePaidBy,
      processingFeePaidBy:
        event.feeStrategy === "buyer_pays" ? "buyer" : "organizer",
    });
    const subtotal = quote.subtotal;
    const fees = quote.platformFee;
    const total = quote.buyerTotal;

    const [order] = await db
      .insert(orders)
      .values({
        eventId,
        // Link the order to the account when there is one. Guest checkout
        // stays guest checkout — that is the point of it — but a signed-in
        // student's purchase needs to be findable in My Events later, and
        // matching on email alone would let anyone see another person's
        // tickets by signing up with their address.
        buyerId: await getSessionUserId(),
        promoterId: await resolvePromoter(eventId, ref),
        promoCodeId: promo?.id ?? null,
        discountAmount: effect.discount.toString(),
        // Frozen here. The code's rate can be edited tomorrow; what this
        // promoter earned tonight cannot.
        commissionAmount: effect.commission.toString(),
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

    if (checked.rows.length) {
      await db.insert(registrationAnswers).values(
        checked.rows.map((row) => ({
          orderId: order.id,
          eventId,
          fieldId: row.fieldId,
          // The label as it read when this person was asked. See the table's
          // comment: renaming a question later must not rewrite history.
          label: row.label,
          value: row.value,
        }))
      );
    }

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
