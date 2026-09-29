import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { sendTicketsForOrder } from "@/lib/ticket-email";

/**
 * POST /api/tickets/recover — re-send someone their tickets.
 *
 * Two deliberate properties:
 *
 * 1. The response never reveals whether the address has tickets. Saying "no
 *    orders found" would turn this into a way to test which students bought
 *    a ticket to which event.
 * 2. Tickets are only ever sent TO the address given, so proving you can
 *    read that inbox is the whole authentication. There is nothing to leak
 *    to the person making the request.
 */
const schema = z.object({ email: z.string().email() });

// Best-effort throttle. In-memory, so it is per server instance and resets on
// deploy — enough to stop someone hammering the form, not a substitute for a
// real rate limiter if this ever gets abused in anger.
const lastSent = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  // Same wording whatever happens, including on a malformed address.
  const ok = NextResponse.json({
    ok: true,
    message:
      "If we have tickets for that address, they're on their way. Check your spam folder too.",
  });

  if (!parsed.success) return ok;

  const email = parsed.data.email.toLowerCase().trim();
  const previous = lastSent.get(email) ?? 0;
  if (Date.now() - previous < COOLDOWN_MS) return ok;
  lastSent.set(email, Date.now());

  const matching = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(eq(orders.email, email));

  const paid = matching.filter((o) => o.status === "paid");

  // Sequential rather than parallel: a handful of orders at most, and the
  // email provider is happier without a burst.
  for (const order of paid.slice(0, 10)) {
    try {
      await sendTicketsForOrder(order.id);
    } catch (error) {
      console.error(`Ticket recovery failed for order ${order.id}:`, error);
    }
  }

  return ok;
}
