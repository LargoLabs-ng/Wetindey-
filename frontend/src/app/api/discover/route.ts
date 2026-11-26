import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, orders, ticketTypes, tickets, universities, users } from "@/db/schema";
import { availableQuantity } from "@/lib/inventory";
import { publicListingWhere } from "@/lib/event-visibility";
import { getSessionUserId } from "@/lib/authz";
import { publicGoingFloor } from "@/lib/going-badge";
import { categoryKey, groupCategories } from "@/lib/categories";

/**
 * GET /api/discover — everything the home and discover surfaces need.
 *
 * Returns published events as ready-to-render cards, soonest first, with the
 * price and availability already worked out so a card never has to reason
 * about ticket tiers.
 *
 * Filtering and search happen on the client for now. At campus scale that is
 * a few dozen events and a fetch is cheaper than a round trip per keystroke;
 * when a university's listing outgrows that, this is where paging goes.
 */
export type DiscoverCard = {
  id: string;
  slug: string;
  title: string;
  hook: string | null;
  coverImage: string | null;
  category: string | null;
  /**
   * The category's grouping key ("Parties." → "party"), so the home page
   * and Discover filters treat differently-typed versions as one. The
   * stored category above is unchanged. See lib/categories.ts.
   */
  categoryKey: string;
  venueName: string | null;
  city: string | null;
  startDatetime: string;
  endDatetime: string;
  /** Provisional — the card prints "Date TBA" instead of the date. */
  dateTbd: boolean;
  venueTbd: boolean;
  minPrice: number | null;
  isFree: boolean;
  /** Nothing left in any tier on sale. How many are left is never sent. */
  soldOut: boolean;
  createdAt: string;
  /** Campus this belongs to. Null means public — everyone's, not nobody's. */
  universityId: string | null;
  campusId: string | null;
  /**
   * The public "N+ going" floor (9, 20, 50, 100 …), or null for no badge.
   * Worked out here from the real count of confirmed tickets, and only the
   * floor leaves the server: the exact number is never sent to the browser.
   * See lib/going-badge.ts.
   */
  goingFloor: number | null;
};

export async function GET() {
  const published = await db
    .select()
    .from(events)
    // Live AND listed — unlisted events are reachable by link, never listed.
    .where(publicListingWhere())
    .orderBy(asc(events.startDatetime));

  const tiers = await db.select().from(ticketTypes);
  const byEvent = new Map<string, typeof tiers>();
  for (const t of tiers) {
    byEvent.set(t.eventId, [...(byEvent.get(t.eventId) ?? []), t]);
  }

  // One grouped count for the whole listing rather than a query per card.
  // "valid" is a ticket that has been paid for; "checked_in" is one already
  // used at the door. Both are people who came. Cancelled and refunded
  // tickets are not, and pending ones are somebody mid-checkout.
  // Sums `admits` rather than counting rows: one table ticket is six people
  // through the door, and counting it as one would make a sold-out gala look
  // like nobody was coming. Ordinary tiers have admits = 1, so this is the
  // same number it always was for them.
  const attending = await db
    .select({
      eventId: tickets.eventId,
      going: sql<number>`coalesce(sum(coalesce(${ticketTypes.admits}, 1)), 0)::int`,
    })
    .from(tickets)
    .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
    .where(inArray(tickets.status, ["valid", "checked_in"]))
    .groupBy(tickets.eventId);

  const goingByEvent = new Map(attending.map((row) => [row.eventId, row.going]));

  // Trending: people with a confirmed ticket from a PAID order placed in the
  // last seven days. Pending, abandoned, cancelled and refunded orders don't
  // count, and neither do tickets refunded since. Only the ranking leaves
  // the server, never the counts, so it can't be used to work out sales.
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const recent = await db
    .select({
      eventId: tickets.eventId,
      people: sql<number>`coalesce(sum(coalesce(${ticketTypes.admits}, 1)), 0)::int`,
    })
    .from(tickets)
    .innerJoin(orders, eq(tickets.orderId, orders.id))
    .leftJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
    .where(
      and(
        inArray(tickets.status, ["valid", "checked_in"]),
        eq(orders.status, "paid"),
        gte(orders.createdAt, weekAgo)
      )
    )
    .groupBy(tickets.eventId);
  const recentByEvent = new Map(recent.map((row) => [row.eventId, row.people]));

  const now = Date.now();

  const cards: DiscoverCard[] = published
    // An event that has already finished is not something to discover.
    .filter((e) => new Date(e.endDatetime).getTime() > now)
    .map((e) => {
      const mine = (byEvent.get(e.id) ?? []).filter((t) => t.status !== "paused");
      const prices = mine.map((t) => Number(t.price));
      const left = mine.reduce((sum, t) => sum + availableQuantity(t), 0);

      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        // A hook, not the whole description — cards are scanned, not read.
        hook: e.description ? e.description.slice(0, 140) : null,
        coverImage: e.coverImage,
        category: e.category,
        categoryKey: categoryKey(e.category),
        venueName: e.venueName,
        city: e.city,
        startDatetime: new Date(e.startDatetime).toISOString(),
        endDatetime: new Date(e.endDatetime).toISOString(),
        dateTbd: e.dateTbd,
        venueTbd: e.venueTbd,
        minPrice: prices.length ? Math.min(...prices) : null,
        isFree: prices.length > 0 && Math.min(...prices) === 0,
        // No tiers at all is not "sold out", it is "nothing on sale yet" —
        // and publishing now requires a tier, so this only affects events
        // published before that rule existed.
        soldOut: mine.length > 0 && left === 0,
        createdAt: new Date(e.createdAt).toISOString(),
        goingFloor: publicGoingFloor(e.id, goingByEvent.get(e.id) ?? 0),
        universityId: e.universityId,
        campusId: e.campusId,
      };
    });

  // Categories that actually have something in them, with differently
  // typed versions of the same one grouped ("Party", "party.", "Parties").
  // A filter chip leading to an empty page is worse than no chip.
  const categories = groupCategories(cards.map((c) => c.category));

  // Listed events ranked by recent sales, busiest first; ties go to the
  // sooner event. Events with no qualifying sales aren't trending.
  const trending = cards
    .filter((c) => (recentByEvent.get(c.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (recentByEvent.get(b.id) ?? 0) - (recentByEvent.get(a.id) ?? 0) ||
        a.startDatetime.localeCompare(b.startDatetime)
    )
    .map((c) => c.id);

  // Universities that have something on, for "Around universities".
  const uniCounts = new Map<string, number>();
  for (const c of cards) {
    if (c.universityId) uniCounts.set(c.universityId, (uniCounts.get(c.universityId) ?? 0) + 1);
  }
  const uniRows = uniCounts.size
    ? await db
        .select({ id: universities.id, name: universities.name, shortName: universities.shortName })
        .from(universities)
        .where(inArray(universities.id, [...uniCounts.keys()]))
    : [];
  const universitiesOn = uniRows
    .map((u) => ({
      id: u.id,
      name: u.shortName || u.name,
      fullName: u.name,
      count: uniCounts.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Who is asking, so the home page can lead with their own campus.
  //
  // Returned alongside the listing rather than fetched separately: the rail
  // and the events it filters have to come from one response, or the page
  // renders "Around UNICROSS" a beat before it knows which events qualify.
  // A signed-out reader gets null and simply sees no campus rail.
  const userId = await getSessionUserId();
  let viewer: { universityId: string; universityName: string; campusId: string | null } | null =
    null;

  if (userId) {
    const me = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { universityId: true, campusId: true },
    });
    if (me?.universityId) {
      const uni = await db.query.universities.findFirst({
        where: eq(universities.id, me.universityId),
        columns: { shortName: true, name: true },
      });
      viewer = {
        universityId: me.universityId,
        universityName: uni?.shortName || uni?.name || "your campus",
        campusId: me.campusId ?? null,
      };
    }
  }

  return NextResponse.json({
    events: cards,
    categories,
    trending,
    universities: universitiesOn,
    total: cards.length,
    viewer,
  });
}
