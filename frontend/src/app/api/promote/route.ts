import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff, events, orders, tickets } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import { appUrl } from "@/lib/app-url";

/**
 * GET /api/promote — the events this person sells for, and how they're doing.
 *
 * Scoped hard to the caller. A promoter is not staff in any meaningful
 * sense: they cannot open the dashboard, cannot see the guest list, and must
 * not learn what anybody else sold. Every query below filters on their own
 * user id, so there is no shape of request that returns another promoter's
 * numbers.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ events: [] });

  const rows = await db
    .select({
      eventId: eventStaff.eventId,
      refCode: eventStaff.refCode,
      title: events.title,
      slug: events.slug,
      status: events.status,
      startDatetime: events.startDatetime,
    })
    .from(eventStaff)
    .innerJoin(events, eq(eventStaff.eventId, events.id))
    .where(
      and(
        eq(eventStaff.userId, userId),
        eq(eventStaff.role, "promoter"),
        eq(eventStaff.status, "active")
      )
    );

  if (rows.length === 0) return NextResponse.json({ events: [] });

  // Tickets sold through this person's link, per event, in one query.
  // Counted from tickets rather than orders because "I sold 12" means twelve
  // people through the door, not twelve transactions.
  const sold = await db
    .select({
      eventId: orders.eventId,
      tickets: sql<number>`count(${tickets.id})::int`,
      revenue: sql<number>`coalesce(sum(${orders.subtotal}), 0)::float`,
    })
    .from(orders)
    .innerJoin(tickets, eq(tickets.orderId, orders.id))
    .where(
      and(
        eq(orders.promoterId, userId),
        eq(orders.status, "paid"),
        inArray(
          orders.eventId,
          rows.map((r) => r.eventId)
        )
      )
    )
    .groupBy(orders.eventId);

  const byEvent = new Map(sold.map((s) => [s.eventId, s]));

  return NextResponse.json({
    events: rows.map((r) => {
      const s = byEvent.get(r.eventId);
      return {
        eventId: r.eventId,
        title: r.title,
        status: r.status,
        startDatetime: new Date(r.startDatetime).toISOString(),
        refCode: r.refCode,
        // The whole product for a promoter is this string. It is built
        // server-side from the same appUrl() every other link uses, so it
        // cannot drift from wherever the app actually lives.
        link: r.refCode
          ? appUrl(`/e/${r.slug}?p=${r.refCode}`)
          : appUrl(`/events/${r.slug}`),
        ticketsSold: s?.tickets ?? 0,
        // What the tickets were worth, not what the promoter is owed. There
        // is no commission in this build and this number must not be mistaken
        // for one.
        faceValue: Math.round((s?.revenue ?? 0) * 100) / 100,
      };
    }),
  });
}
