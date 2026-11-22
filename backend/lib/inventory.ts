import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, tickets, ticketTypes } from "@/db/schema";

/**
 * Ticket inventory lives in two counters on ticket_types:
 *   quantityReserved — held while a checkout is in flight
 *   quantitySold     — confirmed, paid
 *
 * Nothing in the app was ever moving a reservation into the sold column, or
 * releasing one when a checkout was abandoned. The effects were: sold counts
 * stuck at zero forever (so the public page happily oversold), and reserved
 * counts that only ever grew, eventually making a tier unbuyable with zero
 * actual sales. These helpers are the missing half.
 */

/** How many tickets of each type belong to an order. */
async function ticketCountsByType(orderId: string, executor: Executor = db) {
  const rows = await executor
    .select({
      ticketTypeId: tickets.ticketTypeId,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(eq(tickets.orderId, orderId))
    .groupBy(tickets.ticketTypeId);
  return rows;
}

/**
 * Payment confirmed: turn this order's reservations into sales.
 * Counters are clamped so a double-fire can never push them negative.
 * Pass the transaction (`tx`) so this is saved together with the order.
 */
export async function confirmOrderInventory(
  orderId: string,
  executor: Executor = db
): Promise<void> {
  const rows = await ticketCountsByType(orderId, executor);

  for (const row of rows) {
    await executor
      .update(ticketTypes)
      .set({
        quantitySold: sql`${ticketTypes.quantitySold} + ${row.count}`,
        quantityReserved: sql`GREATEST(${ticketTypes.quantityReserved} - ${row.count}, 0)`,
      })
      .where(eq(ticketTypes.id, row.ticketTypeId));
  }

  // Mark anything that just filled up, so it stops being offered.
  const typeIds = rows.map((r) => r.ticketTypeId);
  if (typeIds.length > 0) {
    await executor
      .update(ticketTypes)
      .set({ status: "sold_out" })
      .where(
        and(
          inArray(ticketTypes.id, typeIds),
          eq(ticketTypes.status, "active"),
          sql`${ticketTypes.quantitySold} >= ${ticketTypes.quantityTotal}`
        )
      );
  }
}

/** Checkout failed or was rolled back: give the held inventory back. */
export async function releaseOrderReservation(orderId: string): Promise<void> {
  const rows = await ticketCountsByType(orderId);
  for (const row of rows) {
    await db
      .update(ticketTypes)
      .set({
        quantityReserved: sql`GREATEST(${ticketTypes.quantityReserved} - ${row.count}, 0)`,
      })
      .where(eq(ticketTypes.id, row.ticketTypeId));
  }
}

/**
 * Sweep abandoned checkouts whose 15-minute hold has lapsed.
 *
 * Called at the start of order creation rather than from a cron: the moment
 * inventory actually matters is the moment someone tries to buy, and this
 * keeps the app free of scheduled infrastructure.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        lt(orders.reservationExpiresAt, new Date())
      )
    );

  if (stale.length === 0) return 0;

  let released = 0;
  for (const order of stale) {
    // The expiry is checked again inside the claim, not just in the select
    // above. A payment that arrives late extends its order's hold (see
    // secureSeatsForPayment); without this re-check, a sweep that had
    // already listed the order could still expire it a moment later and
    // hand its seats to someone else while tickets were being issued.
    const claimed = await db
      .update(orders)
      .set({ status: "expired" })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.status, "pending"),
          lt(orders.reservationExpiresAt, new Date())
        )
      )
      .returning({ id: orders.id });
    if (claimed.length === 0) continue;

    await releaseOrderReservation(order.id);
    await db
      .update(tickets)
      .set({ status: "cancelled" })
      .where(and(eq(tickets.orderId, order.id), eq(tickets.status, "pending")));
    released += 1;
  }

  return released;
}

/** How long a checkout holds its seats before they go back on sale. */
export const HOLD_MINUTES = 15;

/** Either the shared client or the `tx` handed to a db.transaction callback. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Hold seats in one statement that only succeeds if enough are left.
 *
 * This replaces "read the counts, check them, then write new counts". Two
 * buyers doing that at the same moment both read "1 left", both pass the
 * check, and both get the last ticket. Here the check is part of the UPDATE
 * itself: Postgres locks the row, and the second buyer's statement re-reads
 * the counts after the first has committed, finds too few, and changes
 * nothing.
 *
 * `onSaleOnly` (the default, for new checkouts) also requires the tier to
 * be active, so a tier paused a split second ago can't be held. A payment
 * that has already been made is held regardless of a pause — only real
 * stock decides that case.
 */
export async function holdSeats(
  ticketTypeId: string,
  quantity: number,
  options: { onSaleOnly?: boolean; executor?: Executor } = {}
): Promise<boolean> {
  const { onSaleOnly = true, executor = db } = options;
  if (!Number.isInteger(quantity) || quantity < 1) return false;

  const held = await executor
    .update(ticketTypes)
    .set({
      quantityReserved: sql`${ticketTypes.quantityReserved} + ${quantity}`,
    })
    .where(
      and(
        eq(ticketTypes.id, ticketTypeId),
        sql`${ticketTypes.quantityTotal} - ${ticketTypes.quantitySold} - ${ticketTypes.quantityReserved} >= ${quantity}`,
        onSaleOnly ? eq(ticketTypes.status, "active") : undefined
      )
    )
    .returning({ id: ticketTypes.id });

  return held.length > 0;
}

/** Give back seats held by holdSeats when nothing ended up using them. */
export async function releaseSeats(
  ticketTypeId: string,
  quantity: number,
  executor: Executor = db
): Promise<void> {
  await executor
    .update(ticketTypes)
    .set({
      quantityReserved: sql`GREATEST(${ticketTypes.quantityReserved} - ${quantity}, 0)`,
    })
    .where(eq(ticketTypes.id, ticketTypeId));
}

export type PaymentSeats = "held" | "no-seats" | "not-applicable";

class NoSeatsLeft extends Error {}

/**
 * Make sure a paid order still has its seats before tickets are issued.
 *
 * A checkout holds its seats for HOLD_MINUTES. A buyer can take longer than
 * that on Paystack (a slow bank transfer, a tab left open), and by then the
 * sweep has expired the order and put its seats back on sale. Issuing the
 * tickets anyway would oversell the event, and moving "held" seats into
 * "sold" would eat into other buyers' holds.
 *
 * So, before finalising, inside one transaction with the order row locked:
 *   - order still pending  → extend its hold, so a sweep can't expire it
 *                            while tickets are being issued → "held"
 *   - order expired        → hold its seats again, only if enough are left;
 *                            put the order back to pending → "held"
 *                            otherwise roll everything back → "no-seats"
 *   - anything else (paid, cancelled, refunded) → "not-applicable", and the
 *     caller carries on exactly as it did before this existed.
 *
 * The lock is what makes a browser return and a webhook arriving together
 * safe: the second waits for the first, then sees the order already pending
 * and simply extends the hold. Ticket issuance itself is still protected by
 * the payment claim in finalizePaidOrder, which this does not touch.
 */
export async function secureSeatsForPayment(orderId: string): Promise<PaymentSeats> {
  try {
    return await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) return "not-applicable" as const;

      const freshHold = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

      if (order.status === "pending") {
        await tx
          .update(orders)
          .set({ reservationExpiresAt: freshHold })
          .where(eq(orders.id, orderId));
        return "held" as const;
      }

      if (order.status !== "expired") return "not-applicable" as const;

      const rows = await tx
        .select({
          ticketTypeId: tickets.ticketTypeId,
          count: sql<number>`count(*)::int`,
        })
        .from(tickets)
        .where(eq(tickets.orderId, orderId))
        .groupBy(tickets.ticketTypeId);

      for (const row of rows) {
        const ok = await holdSeats(row.ticketTypeId, row.count, {
          onSaleOnly: false,
          executor: tx,
        });
        // Throwing rolls back any tier already re-held for this order.
        if (!ok) throw new NoSeatsLeft();
      }

      await tx
        .update(orders)
        .set({ status: "pending", reservationExpiresAt: freshHold })
        .where(eq(orders.id, orderId));
      await tx
        .update(tickets)
        .set({ status: "pending" })
        .where(and(eq(tickets.orderId, orderId), eq(tickets.status, "cancelled")));

      return "held" as const;
    });
  } catch (error) {
    if (error instanceof NoSeatsLeft) return "no-seats";
    throw error;
  }
}

// The single definition of "can someone buy this right now" lives in
// availability.ts, which has no database import, so pure modules (and
// their tests) can use it. Re-exported here so existing imports keep working.
export { availableQuantity } from "@/lib/availability";

/**
 * A refunded ticket frees its seat again: the sale is undone, so the count
 * of sold tickets has to come back down or the tier stays "sold out" to
 * everyone else while a seat sits empty.
 */
export async function releaseRefundedTicket(ticketTypeId: string): Promise<void> {
  await db
    .update(ticketTypes)
    .set({
      quantitySold: sql`GREATEST(${ticketTypes.quantitySold} - 1, 0)`,
      // A tier marked sold_out purely because it filled up should go back on
      // sale; one that an organizer paused by hand stays paused.
      status: sql`CASE WHEN ${ticketTypes.status} = 'sold_out' THEN 'active' ELSE ${ticketTypes.status} END`,
    })
    .where(eq(ticketTypes.id, ticketTypeId));
}
