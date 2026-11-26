import { NextRequest, NextResponse } from 'next/server';
import { appUrl } from "@/lib/app-url";
import { quoteOrder } from "@/lib/fees";
import { db } from '@/db';
import {
  events,
  eventStaff,
  orders,
  registrationAnswers,
  registrationFields,
  tickets,
  payments,
  ticketTypes,
} from '@/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from "node:crypto";
import { getSessionUserId, isUuid } from '@/lib/authz';
import { validateAnswers, type RegistrationField } from '@/lib/registration';
import {
  applyPromo,
  checkCode,
  normalizeCode,
  type PromoCode,
} from '@/lib/promo';
import { loadPromoCode } from '@/lib/promo-lookup';
import { withoutSelfReferral } from '@/lib/referral';
import {
  HOLD_MINUTES,
  holdSeats,
  releaseExpiredReservations,
  releaseOrderReservation,
} from '@/lib/inventory';
import { checkTierSale } from '@/lib/checkout-rules';
import { getBuyerAccount } from '@/lib/buyer-account';
import { initializePaystackCheckout } from "@/lib/paystack";
import { finalizeFreeOrder } from "@/lib/finalize-order";
import { activeTicketPrice } from "@/lib/early-bird";


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

/**
 * The account behind a referral code, when the organiser linked the code to
 * a team member. Null when it isn't linked (a code with only a typed name),
 * or on any failure — like resolvePromoter, this never blocks a purchase.
 */
async function codeOwnerUserId(promo: PromoCode | null): Promise<string | null> {
  if (!promo || promo.kind !== "refer_to_earn" || !promo.staffId) return null;
  try {
    const [row] = await db
      .select({ userId: eventStaff.userId })
      .from(eventStaff)
      .where(eq(eventStaff.id, promo.staffId))
      .limit(1);
    return row?.userId ?? null;
  } catch {
    return null;
  }
}


interface CreateOrderRequest {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  /**
   * Ignored. The order's email is always the signed-in account's verified
   * address — see the account checks in POST. Still accepted so an older
   * page mid-session doesn't fail on an unexpected field.
   */
  buyerEmail?: string;
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
  marketingConsent?: boolean;
}

/** Thrown inside the hold transaction when the seats went to someone else. */
class SeatsGone extends Error {}

function generateQRToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest) {
  try {
    // Every ticket, paid or free, belongs to a signed-in account with a
    // verified email. The event page asks people to sign in before this is
    // ever called, but the page is a courtesy; this is the rule. Checked
    // before anything else, so a signed-out request holds no seats and
    // writes nothing.
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { error: 'Please sign in to get tickets.', code: 'sign_in_required' },
        { status: 401 }
      );
    }
    const account = await getBuyerAccount(userId);
    if (!account) {
      return NextResponse.json(
        { error: 'Please sign in to get tickets.', code: 'sign_in_required' },
        { status: 401 }
      );
    }
    if (!account.emailVerified) {
      return NextResponse.json(
        {
          error: 'Please confirm your email before getting tickets.',
          code: 'email_unverified',
        },
        { status: 403 }
      );
    }
    // Tickets and receipts go to the account's own address. Whatever the
    // page sent as buyerEmail is ignored.
    const buyerEmail = account.email;

    // Hand back inventory from checkouts that were abandoned past their
    // 15-minute hold, before we decide what's available.
    await releaseExpiredReservations();

    const body: CreateOrderRequest = await request.json();
    const {
      eventId,
      ticketTypeId,
      quantity,
      buyerPhone,
      attendees,
      ref,
      marketingConsent,
    } = body;
    const submittedAnswers = body.answers;
    const typedPromoCode = body.promoCode;

    if (!eventId || !ticketTypeId || !quantity || !buyerPhone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // A malformed id makes Postgres throw rather than find nothing.
    if (!isUuid(eventId) || !isUuid(ticketTypeId)) {
      return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 });
    }

    if (
      !Array.isArray(attendees) ||
      attendees.some(
        (a) => typeof a?.name !== 'string' || typeof a?.email !== 'string'
      )
    ) {
      return NextResponse.json(
        { error: 'Please enter a name and email for every attendee.' },
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

    const ticketType = await db.query.ticketTypes.findFirst({
      where: eq(ticketTypes.id, ticketTypeId),
    });

    if (!ticketType) {
      return NextResponse.json(
        { error: 'Ticket type not found' },
        { status: 404 }
      );
    }
    if (ticketType.eventId !== eventId) {
      return NextResponse.json({ error: "Ticket type does not belong to this event." }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ticketType.maxPerOrder) {
      return NextResponse.json(
        { error: `You can buy up to ${ticketType.maxPerOrder} tickets per order.` },
        { status: 400 }
      );
    }

    // Published, not ended (unless the date is still TBA), tier not paused
    // or sold out, inside its sales window, and enough left. The final word
    // on stock is the atomic hold further down; this gives a clear reason
    // when the answer is already no.
    const sale = checkTierSale({ event, tier: ticketType, quantity, now: new Date() });
    if (!sale.ok) {
      return NextResponse.json(
        // `available` deliberately left out: stock numbers are organiser-only.
        { error: sale.message, code: sale.code },
        { status: sale.code === 'event_unavailable' ? 400 : 409 }
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
      const candidate = await loadPromoCode(eventId, typedCode);
      if (candidate) {
        // Including the ticket-type limit: a VIP-only code on a Regular
        // ticket is ignored here exactly like an expired one.
        const check = checkCode(candidate, { ticketTypeId });
        if (check.ok) promo = check.code;
      }
    }

    // Nobody earns from their own purchase (lib/referral.ts). Worked out
    // before the price, though dropping a referral code never changes it.
    const selfCheck = withoutSelfReferral({
      buyerId: account.id,
      linkPromoterId: await resolvePromoter(eventId, ref),
      codeOwnerUserId: await codeOwnerUserId(promo),
    });
    if (selfCheck.dropCode) promo = null;
    const promoterId = selfCheck.promoterId;

    const activePrice = activeTicketPrice(ticketType, new Date()).price;
    const faceValue = activePrice * quantity;
    const effect = applyPromo(faceValue, promo);

    // The buyer covers Paystack's processing charge. Wetin Dey's 5% is
    // deducted from the organiser's ticket proceeds.
    const quote = quoteOrder(effect.faceAfter, {
      platformFeePaidBy: "organizer",
    });
    const subtotal = quote.subtotal;
    const fees = quote.platformFee;
    const total = quote.buyerTotal;

    // Hold the seats and write the order in one transaction. The hold is a
    // single conditional UPDATE (see holdSeats), so two buyers going for the
    // last ticket can't both get it; and if anything after it fails, the
    // whole thing rolls back and no seat is left stuck on hold.
    let order: typeof orders.$inferSelect;
    try {
      order = await db.transaction(async (tx) => {
        const held = await holdSeats(ticketTypeId, quantity, { executor: tx });
        if (!held) throw new SeatsGone();

        const [created] = await tx
          .insert(orders)
          .values({
            eventId,
            buyerId: account.id,
            promoterId,
            promoCodeId: promo?.id ?? null,
            discountAmount: effect.discount.toString(),
            ticketUnitPrice: activePrice.toFixed(2),
            // Frozen here. The code's rate can be edited tomorrow; what this
            // promoter earned tonight cannot.
            commissionAmount: effect.commission.toString(),
            marketingConsent: marketingConsent === true,
            email: buyerEmail,
            phone: buyerPhone,
            subtotal: subtotal.toString(),
            fees: fees.toString(),
            total: total.toString(),
            platformFeePaidBy: "organizer",
            status: 'pending' as const,
            reservationExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
          })
          .returning();

        // Attendee details stay exactly as typed: buying for friends is
        // normal, and their names and emails needn't match the account.
        await tx.insert(tickets).values(
          attendees.map((attendee) => ({
            orderId: created.id,
            eventId,
            ticketTypeId,
            attendeeName: attendee.name,
            attendeeEmail: attendee.email,
            qrToken: generateQRToken(),
            status: 'pending' as const,
          }))
        );

        if (checked.rows.length) {
          await tx.insert(registrationAnswers).values(
            checked.rows.map((row) => ({
              orderId: created.id,
              eventId,
              fieldId: row.fieldId,
              // The label as it read when this person was asked. See the table's
              // comment: renaming a question later must not rewrite history.
              label: row.label,
              value: row.value,
            }))
          );
        }

        return created;
      });
    } catch (holdError) {
      if (holdError instanceof SeatsGone) {
        return NextResponse.json(
          {
            error:
              'Someone just got the last of these. Please pick another ticket or a smaller number.',
            code: 'not_enough',
          },
          { status: 409 }
        );
      }
      throw holdError;
    }

    const paymentReference = `WD-${order.id.slice(0, 8)}-${randomUUID()}`;

    if (quote.buyerTotal === 0) {
      try {
        await db.insert(payments).values({
          orderId: order.id,
          provider: "free",
          providerReference: paymentReference,
          amount: "0",
          status: "success",
          rawProviderResponse: { free: true },
        });
      } catch (paymentError) {
        await releaseOrderReservation(order.id);
        await db.delete(orders).where(eq(orders.id, order.id));
        throw paymentError;
      }
      if (!(await finalizeFreeOrder(order.id))) {
        throw new Error("Could not complete the free ticket order.");
      }
      return NextResponse.json({
        orderId: order.id,
        paymentUrl: appUrl(
          `/payment/callback?reference=${encodeURIComponent(paymentReference)}`
        ),
      });
    }

    // Any provider failure after inventory reservation gives held tickets back.
    let paystackCheckout: Awaited<ReturnType<typeof initializePaystackCheckout>>;
    try {
      paystackCheckout = await initializePaystackCheckout({
        amount: quote.paystackAmount,
        email: buyerEmail,
        reference: paymentReference,
        callbackUrl: appUrl(
          `/payment/callback?reference=${encodeURIComponent(paymentReference)}`
        ),
        metadata: {
          orderId: order.id,
          eventId,
          eventTitle: event.title,
          ticketCount: quantity,
        },
      });
      await db.insert(payments).values({
        orderId: order.id,
        provider: "paystack",
        providerReference: paymentReference,
        amount: quote.paystackAmount.toString(),
        status: "initialized",
        rawProviderResponse: paystackCheckout.raw,
      });
    } catch (paymentError) {
      await releaseOrderReservation(order.id);
      await db.delete(orders).where(eq(orders.id, order.id));
      throw paymentError;
    }

    return NextResponse.json({
      orderId: order.id,
      paymentUrl: paystackCheckout.checkout.authorization_url,
    });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create order' },
      { status: 500 }
    );
  }
}
