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
async function ticketCountsByType(orderId: string) {
  const rows = await db
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
 */
export async function confirmOrderInventory(orderId: string): Promise<void> {
  const rows = await ticketCountsByType(orderId);

  for (const row of rows) {
    await db
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
    await db
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

  for (const order of stale) {
    await releaseOrderReservation(order.id);
    await db
      .update(tickets)
      .set({ status: "cancelled" })
      .where(and(eq(tickets.orderId, order.id), eq(tickets.status, "pending")));
    await db
      .update(orders)
      .set({ status: "expired" })
      .where(eq(orders.id, order.id));
  }

  return stale.length;
}

/** The single definition of "can someone buy this right now". */
export function availableQuantity(tier: {
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
}): number {
  return Math.max(
    0,
    tier.quantityTotal - tier.quantitySold - tier.quantityReserved
  );
}
