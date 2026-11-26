"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { AccountNav } from "@/components/account-nav";
import { OrganisingStrip } from "@/components/organising-strip";
import {
  EventFeature,
  EventRail,
  type CardEvent,
} from "@/components/event-card";

/**
 * The front door.
 *
 * It used to be a ticketing SaaS landing page — hero, features, dashboard
 * screenshot, FAQ, pricing — selling software to organizers. But organizers
 * are the smaller audience and they arrive already knowing why they came.
 * The larger one is a student with no idea what's on, and the honest way to
 * convince them is to show them what's on.
 *
 * So: real events above everything else. The pitch to organizers survives as
 * one strip near the bottom, which is roughly the attention it deserves.
 */
type Viewer = {
  universityId: string;
  universityName: string;
  campusId: string | null;
} | null;

type CategoryChip = { key: string; name: string; count: number };
type UniversityTile = { id: string; name: string; fullName: string; count: number };

/** "Browse by category": every grouped category, each a link into Discover. */
function CategoryBrowse({ categories }: { categories: CategoryChip[] }) {
  // One category isn't a choice, it's a label.
  if (categories.length < 2) return null;
  return (
    <section className="mt-14">
      <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">Browse by category</h2>
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {categories.map((c) => (
          <Link
            key={c.key}
            href={`/discover?category=${encodeURIComponent(c.key)}`}
            className="whitespace-nowrap rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:border-purple hover:text-purple"
          >
            {c.name}
            <span className="ml-1.5 text-ink-3">{c.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * "Around universities": one tile per school with something on, linking to
 * Discover filtered to that school. Tiles rather than more cards, so no
 * event shows up twice on the page. The viewer's own school comes first.
 */
function UniversityBrowse({
  universities,
  viewer,
}: {
  universities: UniversityTile[];
  viewer: Viewer;
}) {
  const ordered = viewer
    ? [...universities].sort(
        (a, b) =>
          Number(b.id === viewer.universityId) - Number(a.id === viewer.universityId)
      )
    : universities;
  // Only their own school? The campus row above already covers it.
  if (ordered.length === 0) return null;
  if (ordered.length === 1 && viewer && ordered[0].id === viewer.universityId) return null;

  return (
    <section className="mt-14">
      <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">Around universities</h2>
      <p className="mt-0.5 text-sm text-ink-3">What&apos;s on, school by school</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ordered.map((u) => (
          <Link
            key={u.id}
            href={`/discover?uni=${encodeURIComponent(u.id)}`}
            title={u.fullName}
            className="rounded-2xl border border-line bg-card p-4 hover:border-purple"
          >
            <p className="truncate font-extrabold text-ink">{u.name}</p>
            <p className="mt-1 text-sm text-ink-3">
              {u.count} {u.count === 1 ? "event" : "events"}
              {viewer && u.id === viewer.universityId ? " · your school" : ""}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const [events, setEvents] = useState<CardEvent[] | null>(null);
  const [viewer, setViewer] = useState<Viewer>(null);
  const [categories, setCategories] = useState<CategoryChip[]>([]);
  const [trendingIds, setTrendingIds] = useState<string[]>([]);
  const [universities, setUniversities] = useState<UniversityTile[]>([]);

  useEffect(() => {
    fetch("/api/discover")
      .then((r) => r.json())
      .then((d) => {
        setEvents(d.events ?? []);
        setViewer(d.viewer ?? null);
        setCategories(d.categories ?? []);
        setTrendingIds(d.trending ?? []);
        setUniversities(d.universities ?? []);
      })
      .catch(() => setEvents([]));
  }, []);

  /**
   * Each event appears in exactly one place on this page.
   *
   * Every rail used to filter the full list independently, so with a handful
   * of events the same three cards showed up under "Happening soon", "Just
   * dropped" and "Free entry" one after another. Repetition is how a page
   * announces that it is empty. `take` hands each section only what no
   * earlier section has already used, and a section that comes up empty
   * renders nothing at all.
   */
  const all = events ?? [];
  const spent = new Set<string>();
  const take = (
    pick: (e: CardEvent) => boolean,
    limit = 8,
    sort?: (a: CardEvent, b: CardEvent) => number
  ) => {
    const chosen = all
      .filter((e) => !spent.has(e.id) && pick(e))
      .sort(sort ?? (() => 0))
      .slice(0, limit);
    chosen.forEach((e) => spent.add(e.id));
    return chosen;
  };

  const now = Date.now();

  /**
   * Sections are for organising abundance. Below a certain number of events
   * they stop organising anything and become scaffolding around emptiness —
   * four headings, one card each, which is how the page looked with three
   * events on it. A heading over a single card is overhead, not structure.
   *
   * So the page changes shape with how much there is: one feature and one
   * rail while the listing is small, the full set of cuts once there are
   * enough events for a cut to mean something.
   */
  const SECTION_FROM = 6; // events, below which the page stays simple
  const SECTION_MIN = 2; // cards, below which a section is not worth a heading
  const sectioned = all.length >= SECTION_FROM;

  // Exactly one event gets the big treatment, and only because it is the
  // soonest — an actual ranking rather than a layout preference. Their own
  // campus wins the slot when we know it, otherwise the soonest anywhere.
  const [next] = viewer
    ? take((e) => e.universityId === viewer.universityId, 1)
    : take(() => true, 1);

  // A cut only happens when the page is big enough to need cutting, and only
  // keeps what it takes if that is enough to fill a row. Anything it turns
  // down stays in the pool for the catch-all at the bottom, so no event is
  // ever dropped by a section refusing it.
  const cut = (
    pick: (e: CardEvent) => boolean,
    sort?: (a: CardEvent, b: CardEvent) => number
  ) => {
    if (!sectioned) return [];
    const chosen = all
      .filter((e) => !spent.has(e.id) && pick(e))
      .sort(sort ?? (() => 0))
      .slice(0, 8);
    if (chosen.length < SECTION_MIN) return [];
    chosen.forEach((e) => spent.add(e.id));
    return chosen;
  };

  const campus = viewer
    ? cut((e) => e.universityId === viewer.universityId)
    : [];

  // Trending: the server's ranking by tickets sold this week (it never
  // sends the counts). Shown whenever at least two events qualify, even on
  // a small listing — that is the one row worth having at any size. An
  // event already used above stays where it is.
  const trending = (() => {
    const byId = new Map(all.map((e) => [e.id, e]));
    const chosen = trendingIds
      .map((id) => byId.get(id))
      .filter((e): e is CardEvent => !!e && !spent.has(e.id))
      .slice(0, 8);
    if (chosen.length < SECTION_MIN) return [];
    chosen.forEach((e) => spent.add(e.id));
    return chosen;
  })();
  const soon = cut((e) => new Date(e.startDatetime).getTime() - now < 14 * 86400000);
  const justDropped = cut(
    (e) => !!e.createdAt && now - new Date(e.createdAt).getTime() < 14 * 86400000,
    (a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1)
  );
  const free = cut((e) => e.isFree);
  const rest = take(() => true, 12);

  return (
    <div className="wd-night min-h-screen bg-cream">
      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="relative border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          {/* Shared with Discover, event pages and My events. It knows who
              is looking: Sign in for visitors; My events, Profile and one
              organiser link ("Organiser mode" or "Host an event") for
              signed-in people. */}
          <AccountNav />
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "var(--color-indigo)" }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 select-none text-[13rem] font-extrabold leading-none sm:right-6 sm:text-[20rem]"
          style={{ color: "var(--color-purple-lift)", opacity: 0.16 }}
        >
          ?
        </span>

        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <p
            className="text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--color-purple-lift)" }}
          >
            Your plug for what&apos;s happening
          </p>
          <h1
            className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-6xl"
            style={{ color: "var(--color-on-dark)" }}
          >
            Wetin dey
            <br />
            this weekend?
          </h1>
          <p
            className="mt-5 max-w-lg text-lg"
            style={{ color: "var(--color-on-dark-2)" }}
          >
            Parties, seminars, career fairs, match days — everything happening
            around your campus. Find it, grab your spot, no miss am.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/discover"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-purple-deep"
            >
              <Search className="h-4 w-4" />
              See wetin dey
            </Link>
            <Link
              // /organiser sends signed-in people to their dashboard and shows
              // everyone else the host page, so one link serves both.
              href="/organiser"
              className="inline-flex items-center justify-center rounded-xl border px-6 py-3.5 text-base font-semibold transition-colors"
              style={{
                borderColor: "var(--color-indigo-line)",
                color: "var(--color-on-dark)",
              }}
            >
              I&apos;m hosting something
            </Link>
          </div>
        </div>
      </section>

      {/* ── Real events ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {/* Above the discovery rails, and outside the loading/empty branch
            below: somebody who runs events still has events to manage on a
            day when nothing is published, and "Nothing dey here yet" must
            not be the whole of their home page. */}
        <OrganisingStrip />

        {events === null ? (
          <p className="pt-12 text-ink-3">Loading what&apos;s on…</p>
        ) : events.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-line bg-card p-10 text-center">
            <p className="text-xl font-extrabold text-ink">Nothing dey here yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-ink-2">
              No events posted yet. If you&apos;re running something, you can be
              the first — it takes about two minutes.
            </p>
            <Link
              href="/organiser"
              className="mt-5 inline-block rounded-lg bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-deep"
            >
              Post your event
            </Link>
          </div>
        ) : (
          <>
            <EventFeature
              title="Wetin dey next"
              note={
                viewer && next?.universityId === viewer.universityId
                  ? `The next one at ${viewer.universityName}`
                  : "Closest to happening"
              }
              event={next}
              href="/discover"
            />

            <EventRail
              title={`Around ${viewer?.universityName ?? "campus"}`}
              note="Everything else at your school"
              events={campus}
              href={viewer ? `/discover?uni=${encodeURIComponent(viewer.universityId)}` : "/discover"}
            />

            <EventRail
              title="Trending"
              note="Most tickets this week"
              events={trending}
            />

            <CategoryBrowse categories={categories} />

            <EventRail
              title="Happening soon"
              note="In the next two weeks"
              events={soon}
              href="/discover"
            />
            <EventRail
              title="Just dropped"
              note="Posted in the last fortnight"
              events={justDropped}
              href="/discover"
            />
            <EventRail
              title="Free entry"
              note="No ticket money required"
              events={free}
              href="/discover?free=1"
            />
            <UniversityBrowse universities={universities} viewer={viewer} />

            <EventRail
              title={sectioned ? "Also on" : "Wetin else dey"}
              note={
                sectioned
                  ? undefined
                  : viewer
                    ? "Around you and beyond"
                    : "Everything else on"
              }
              events={rest}
              href="/discover"
            />

            <div className="mt-14 text-center">
              <Link
                href="/discover"
                className="inline-block rounded-xl border border-line bg-card px-6 py-3 font-semibold text-ink hover:border-ink-3"
              >
                See everything
              </Link>
            </div>
          </>
        )}
      </div>

      {/* ── For organisers, kept to its proper size ───────────────────── */}
      <section className="border-y border-line bg-card">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-ink">
              Running something?
            </h2>
            <p className="mt-1 max-w-md text-ink-2">
              Set your tiers, share one link, scan people in at the door.
            </p>
          </div>
          <Link
            href="/organiser"
            className="shrink-0 rounded-xl bg-purple px-5 py-3 font-semibold text-white hover:bg-purple-deep"
          >
            Post an event
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-nowrap items-center justify-between gap-2">
          <WordMark asLink={false} />
          <p className="whitespace-nowrap text-[10px] text-ink-3 sm:text-sm">
            © {new Date().getFullYear()} Largo Labs Ltd. All rights reserved.
          </p>
          <p className="whitespace-nowrap text-[10px] text-ink-3 sm:text-sm">
            Calabar, Nigeria
          </p>
        </div>
      </footer>
    </div>
  );
}
