/**
 * Ticket sales for the organiser dashboard.
 *
 * "Ticket sales" means what the tickets sold for: the order subtotal (after
 * any discount code), never the total the buyer paid, which also includes
 * the Paystack processing fee the organiser never receives. Refunded
 * tickets take their share of the order with them.
 *
 * This is the same rule the Finance page uses for "Ticket sales" (see
 * orderOrganizerNet in earnings-compute.ts), so the two pages always agree.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff, orders, tickets, users } from "@/db/schema";

/** Tickets that still count: issued or already scanned. */
export const LIVE_TICKET_STATUSES = ["valid", "checked_in"] as const;

const isLive = (status: string) => (LIVE_TICKET_STATUSES as readonly string[]).includes(status);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (value: string | number) => {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
};

export type RevenueOrder = { id: string; subtotal: string | number };
export type RevenueTicket = { orderId: string; ticketTypeId: string; status: string };

/**
 * Ticket sales in total and per ticket type, from PAID orders and their tickets.
 *
 * Each ticket is worth its order's subtotal divided by the order's ticket
 * count. Only live tickets are counted, so a refunded ticket's share drops
 * out, exactly as on the Finance page.
 */
export function ticketSales(paidOrders: RevenueOrder[], eventTickets: RevenueTicket[]) {
  const ticketsByOrder = new Map<string, RevenueTicket[]>();
  for (const t of eventTickets) {
    const list = ticketsByOrder.get(t.orderId);
    if (list) list.push(t);
    else ticketsByOrder.set(t.orderId, [t]);
  }

  let total = 0;
  const byTicketType = new Map<string, number>();
  for (const order of paidOrders) {
    const subtotal = num(order.subtotal);
    const orderTickets = ticketsByOrder.get(order.id) ?? [];
    if (orderTickets.length === 0) {
      // A paid order with no ticket rows shouldn't exist; count it whole
      // rather than silently erase the sale (as the Finance page does).
      total += subtotal;
      continue;
    }
    const each = subtotal / orderTickets.length;
    for (const t of orderTickets) {
      if (!isLive(t.status)) continue;
      total += each;
      byTicketType.set(t.ticketTypeId, (byTicketType.get(t.ticketTypeId) ?? 0) + each);
    }
  }

  return {
    total: round2(total),
    byTicketType: new Map([...byTicketType].map(([id, v]) => [id, round2(v)])),
  };
}

/**
 * Each active promoter on an event, with the live tickets they sold and
 * the face value of those tickets. A promoter with no sales still appears,
 * with zeros.
 *
 * Totals are worked out per order first, then added up per promoter, so an
 * order with several tickets is counted once, not once per ticket.
 */
export async function promoterSales(eventId: string) {
  const perOrder = db
    .select({
      orderId: tickets.orderId,
      all: sql<number>`count(*)::int`.as("all_tickets"),
      live: sql<number>`(count(*) filter (where ${tickets.status} in ('valid', 'checked_in')))::int`.as(
        "live_tickets"
      ),
    })
    .from(tickets)
    .where(eq(tickets.eventId, eventId))
    .groupBy(tickets.orderId)
    .as("per_order");

  return db
    .select({
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
      refCode: eventStaff.refCode,
      sold: sql<number>`coalesce(sum(${perOrder.live}), 0)::int`,
      faceValue: sql<number>`coalesce(round(sum(
        ${orders.subtotal} * case when ${perOrder.all} > 0 then ${perOrder.live}::numeric / ${perOrder.all} else 1 end
      ), 2), 0)::float`,
    })
    .from(eventStaff)
    .innerJoin(users, eq(users.id, eventStaff.userId))
    .leftJoin(
      orders,
      and(eq(orders.promoterId, eventStaff.userId), eq(orders.eventId, eventId), eq(orders.status, "paid"))
    )
    .leftJoin(perOrder, eq(perOrder.orderId, orders.id))
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.role, "promoter"), eq(eventStaff.status, "active")))
    .groupBy(users.name, users.firstName, users.lastName, eventStaff.refCode)
    .orderBy(sql`coalesce(sum(${perOrder.live}), 0) desc`);
}

/**
 * One promoter's own figures, per event — what their Promote page shows.
 *
 * The same rule as promoterSales above, so the promoter and the organiser
 * always see the same numbers: paid orders only, live tickets only, and each
 * order's subtotal split across its tickets so a refunded ticket takes its
 * share with it. A cancelled event voids its tickets, so it drops to zero.
 */
export async function salesForPromoter(promoterUserId: string, eventIds: string[]) {
  const result = new Map<string, { sold: number; faceValue: number }>();
  if (eventIds.length === 0) return result;

  const perOrder = db
    .select({
      orderId: tickets.orderId,
      all: sql<number>`count(*)::int`.as("all_tickets"),
      live: sql<number>`(count(*) filter (where ${tickets.status} in ('valid', 'checked_in')))::int`.as(
        "live_tickets"
      ),
    })
    .from(tickets)
    .where(inArray(tickets.eventId, eventIds))
    .groupBy(tickets.orderId)
    .as("per_order");

  const rows = await db
    .select({
      eventId: orders.eventId,
      sold: sql<number>`coalesce(sum(${perOrder.live}), 0)::int`,
      faceValue: sql<number>`coalesce(round(sum(
        ${orders.subtotal} * case when ${perOrder.all} > 0 then ${perOrder.live}::numeric / ${perOrder.all} else 1 end
      ), 2), 0)::float`,
    })
    .from(orders)
    .innerJoin(perOrder, eq(perOrder.orderId, orders.id))
    .where(
      and(
        eq(orders.promoterId, promoterUserId),
        eq(orders.status, "paid"),
        inArray(orders.eventId, eventIds)
      )
    )
    .groupBy(orders.eventId);

  for (const r of rows) {
    result.set(r.eventId, { sold: Number(r.sold) || 0, faceValue: Number(r.faceValue) || 0 });
  }
  return result;
}
