import { and, eq, isNull } from "drizzle-orm";
import { events } from "@/db/schema";

/**
 * Listed vs unlisted — the one place the rule lives.
 *
 * Two separate questions, answered by two separate columns:
 *
 *   status = 'published' (and not archived)  → the event is LIVE: its page
 *     loads, tickets sell, the conversation is open. Unchanged by this file.
 *   visibility = 'public'                    → the event is also LISTED:
 *     discovery, the homepage rails, the public events API, search engines.
 *
 * An unlisted event is live but not listed — like an unlisted video: anyone
 * with the link can open it and buy a ticket, nobody stumbles on it. Slugs
 * are built from the title, so "unlisted" means "not advertised", not
 * "secret".
 *
 * Anything that LISTS events to the public must filter with
 * publicListingWhere() (in SQL) or isPubliclyListed() (in memory). A new
 * listing that forgets to is how an unlisted event leaks.
 */

export const EVENT_VISIBILITIES = ["public", "unlisted"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

/**
 * Anything that isn't explicitly 'unlisted' is public. The column is NOT NULL
 * with a 'public' default, so this only matters for objects built before the
 * column existed — and for those, public is exactly how they behaved.
 */
export function normalizeVisibility(value: unknown): EventVisibility {
  return value === "unlisted" ? "unlisted" : "public";
}

type ListableEvent = {
  status: string;
  archivedAt: Date | string | null;
  visibility?: string | null;
};

/** Live: the page loads and tickets sell. Same rule the routes use today. */
export function isLive(event: Pick<ListableEvent, "status" | "archivedAt">): boolean {
  return event.status === "published" && !event.archivedAt;
}

/** Live AND listed: may appear in discovery and public listings. */
export function isPubliclyListed(event: ListableEvent): boolean {
  return isLive(event) && normalizeVisibility(event.visibility) === "public";
}

/** The SQL form of isPubliclyListed(), for every public listing query. */
export function publicListingWhere() {
  return and(
    eq(events.status, "published"),
    isNull(events.archivedAt),
    eq(events.visibility, "public")
  );
}

/**
 * Robots metadata for a live event page. Undefined for public events, so
 * their metadata is exactly what it was before this feature. Unlisted pages
 * keep their link preview (sharing the link is the point) but tell search
 * engines not to index them or follow links from them.
 */
export function eventRobots(event: Pick<ListableEvent, "visibility">):
  | { index: false; follow: false; googleBot: { index: false; follow: false } }
  | undefined {
  if (normalizeVisibility(event.visibility) !== "unlisted") return undefined;
  return { index: false, follow: false, googleBot: { index: false, follow: false } };
}
