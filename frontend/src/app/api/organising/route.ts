import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ticketTypes } from "@/db/schema";
import { getSessionUserId, getStaffedEvents } from "@/lib/authz";
import { can } from "@/lib/permissions";

/**
 * GET /api/organising — events this person runs or works on.
 *
 * Exists because the only organiser link on the consumer side was "Post an
 * event", which assumes you want a new one. Plenty of organisers have no
 * interest in discovering anybody else's event; what they came for is the
 * one they are already running, and it was three clicks into a dashboard
 * they had to know existed.
 *
 * Returns nothing rather than 401 for a student with no events, so the home
 * page can call it unconditionally and simply render nothing.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ events: [] });

  const staffed = await getStaffedEvents(userId);
  if (staffed.length === 0) return NextResponse.json({ events: [] });

  // Sold and capacity in one grouped query rather than one per event.
  const tiers = await db
    .select({
      eventId: ticketTypes.eventId,
      sold: sql<number>`coalesce(sum(${ticketTypes.quantitySold}), 0)::int`,
      total: sql<number>`coalesce(sum(${ticketTypes.quantityTotal}), 0)::int`,
    })
    .from(ticketTypes)
    .where(
      inArray(
        ticketTypes.eventId,
        staffed.map((e) => e.id)
      )
    )
    .groupBy(ticketTypes.eventId);

  const counts = new Map(tiers.map((t) => [t.eventId, t]));

  const now = Date.now();

  return NextResponse.json({
    events: staffed
      // Finished events belong in the dashboard's history, not on the front
      // page. Cancelled ones stay: an organiser who just called something off
      // still has refunds to settle.
      .filter(
        (e) =>
          e.status === "cancelled" ||
          new Date(e.startDatetime).getTime() > now - 86400000
      )
      .sort(
        (a, b) =>
          new Date(a.startDatetime).getTime() - new Date(b.startDatetime).getTime()
      )
      .map((e) => {
        const c = counts.get(e.id);
        return {
          id: e.id,
          title: e.title,
          slug: e.slug,
          startDatetime: new Date(e.startDatetime).toISOString(),
          // The organiser's own working date, shown to them even while it is
          // unconfirmed — this flag hides it from the public, not from the
          // person who set it. The strip flags it so they can see at a glance
          // which of their events still needs pinning down.
          dateTbd: e.dateTbd,
          status: e.status,
          role: e.role,
          sold: c?.sold ?? 0,
          capacity: c?.total ?? 0,
          /**
           * Where tapping it goes, decided by what this person may actually
           * do. A gate volunteer cannot open the management view at all, so
           * sending them there would be a link to a 403 — their event opens
           * the scanner instead, which is their whole job.
           */
          href: can(e.role, "event:view")
            ? `/dashboard/events/${e.id}`
            : `/checkin/${e.id}`,
        };
      }),
  });
}
