import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  failPendingOrder,
  finalizePaidOrder,
  recordExternalRefund,
} from '@/lib/finalize-order';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * POST /api/webhooks/paystack
 *
 * Verifies the signature, then hands off to finalizePaidOrder — the same
 * function the buyer's return to the site calls. The webhook used to own that
 * logic outright, which made it a single point of failure: no webhook, no
 * ticket, forever.
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-paystack-signature');
    const body = await request.text();

    if (!signature || !PAYSTACK_SECRET) {
      return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
    }

    const hash = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');

    // Constant-time compare so the response time can't be used to guess
    // a valid signature byte by byte.
    const expected = Buffer.from(hash, 'utf8');
    const received = Buffer.from(signature, 'utf8');
    const signatureValid =
      expected.length === received.length && timingSafeEqual(expected, received);

    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(body);
    const reference: string | undefined = event?.data?.reference;

    if (event.event === 'charge.success') {
      if (!reference) {
        return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
      }

      const result = await finalizePaidOrder(reference);
      if (!result.ok) {
        // Unknown reference is not an error worth retrying — acknowledge it
        // so Paystack stops resending.
        console.log(`Webhook for unknown reference: ${reference}`);
        return NextResponse.json({ success: true, message: 'Unknown reference' });
      }

      return NextResponse.json({
        success: true,
        orderId: result.orderId,
        alreadyProcessed: result.alreadyDone,
      });
    }

    if (event.event === 'charge.failed') {
      if (!reference) {
        return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
      }

      const result = await failPendingOrder(reference);
      if (!result.ok) {
        console.log(`charge.failed for unknown reference: ${reference}`);
        return NextResponse.json({ success: true, message: 'Unknown reference' });
      }

      return NextResponse.json({
        success: true,
        orderId: result.orderId,
        alreadyProcessed: result.alreadyDone,
      });
    }

    if (event.event === 'refund.processed') {
      // Paystack has moved this field around between payload versions, and a
      // refund we silently drop is a ticket that stays valid after the money
      // has gone back. Check every shape it has used rather than trusting one.
      const transactionRef: string | undefined =
        event?.data?.transaction_reference ??
        event?.data?.transaction?.reference ??
        reference;

      if (!transactionRef) {
        console.error('refund.processed with no transaction reference', event?.data);
        return NextResponse.json({ success: true, message: 'No transaction reference' });
      }

      const result = await recordExternalRefund({
        reference: transactionRef,
        amountMinor: event?.data?.amount,
        providerReference: event?.data?.reference ?? event?.data?.refund_reference,
        raw: event?.data,
      });

      if (!result.ok) {
        console.log(`refund.processed ignored (${result.reason}): ${transactionRef}`);
        return NextResponse.json({ success: true, message: result.reason });
      }

      return NextResponse.json({
        success: true,
        orderId: result.orderId,
        full: result.full,
        alreadyRecorded: result.alreadyRecorded,
      });
    }

    // Anything else is acknowledged so Paystack stops resending, and logged
    // so an event type we should be handling doesn't disappear in silence.
    console.log(`Unhandled Paystack event: ${event.event}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
