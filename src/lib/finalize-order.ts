import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, tickets } from "@/db/schema";
import { confirmOrderInventory } from "@/lib/inventory";
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
  // a Paystack retry — can both read 'initialized' before either writes, and
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

/**
 * Ask Paystack directly whether a reference was paid.
 *
 * The old /api/payment/verify only read our own database, so it reported
 * "pending" forever whenever the webhook had not arrived — which is precisely
 * the situation verification exists to rescue.
 */
export async function isPaidAtPaystack(reference: string): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;

  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" }
    );
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === true && body?.data?.status === "success";
  } catch (error) {
    console.error(`Paystack verify failed for ${reference}:`, error);
    return false;
  }
}
