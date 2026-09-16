import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, ticketTypes } from "@/db/schema";
import { availableQuantity } from "@/lib/inventory";

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
  venueName: string | null;
  city: string | null;
  startDatetime: string;
  endDatetime: string;
  minPrice: number | null;
  isFree: boolean;
  soldOut: boolean;
  ticketsLeft: number;
  createdAt: string;
};

export async function GET() {
  const published = await db
    .select()
    .from(events)
    .where(eq(events.status, "published"))
    .orderBy(asc(events.startDatetime));

  const tiers = await db.select().from(ticketTypes);
  const byEvent = new Map<string, typeof tiers>();
  for (const t of tiers) {
    byEvent.set(t.eventId, [...(byEvent.get(t.eventId) ?? []), t]);
  }

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
        venueName: e.venueName,
        city: e.city,
        startDatetime: new Date(e.startDatetime).toISOString(),
        endDatetime: new Date(e.endDatetime).toISOString(),
        minPrice: prices.length ? Math.min(...prices) : null,
        isFree: prices.length > 0 && Math.min(...prices) === 0,
        // No tiers at all is not "sold out", it is "nothing on sale yet" —
        // and publishing now requires a tier, so this only affects events
        // published before that rule existed.
        soldOut: mine.length > 0 && left === 0,
        ticketsLeft: left,
        createdAt: new Date(e.createdAt).toISOString(),
      };
    });

  // Categories that actually have something in them. A filter chip leading to
  // an empty page is worse than no chip.
  const counts = new Map<string, number>();
  for (const c of cards) {
    const key = (c.category ?? "").trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json({ events: cards, categories, total: cards.length });
}
