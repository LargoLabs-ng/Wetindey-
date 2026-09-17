"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { EventCardItem, FeaturedCard, type CardEvent } from "@/components/event-card";

type Payload = { events: CardEvent[]; categories: { name: string; count: number }[] };

const WHEN = [
  { key: "any", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This weekend" },
  { key: "month", label: "This month" },
] as const;

type WhenKey = (typeof WHEN)[number]["key"];

/** Saturday and Sunday of the current week. */
function weekendRange() {
  const now = new Date();
  const day = now.getDay(); // 0 Sun … 6 Sat
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - day + 7) % 7));
  sat.setHours(0, 0, 0, 0);
  const mon = new Date(sat);
  mon.setDate(sat.getDate() + 2);
  return [sat.getTime(), mon.getTime()] as const;
}

function inWindow(iso: string, key: WhenKey) {
  if (key === "any") return true;
  const t = new Date(iso).getTime();
  const now = new Date();
  if (key === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return t >= start.getTime() && t < end.getTime();
  }
  if (key === "weekend") {
    const [from, to] = weekendRange();
    return t >= from && t < to;
  }
  const end = new Date(now);
  end.setMonth(now.getMonth() + 1);
  return t <= end.getTime();
}

export default function DiscoverPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [when, setWhen] = useState<WhenKey>("any");
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    fetch("/api/discover")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ events: [], categories: [] }))
      .finally(() => setLoading(false));
  }, []);

  const results = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.events.filter((e) => {
      if (category && e.category !== category) return false;
      if (freeOnly && !e.isFree) return false;
      if (!inWindow(e.startDatetime, when)) return false;
      if (!needle) return true;
      return [e.title, e.hook, e.venueName, e.city, e.category]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle));
    });
  }, [data, q, category, when, freeOnly]);

  const filtering = Boolean(q.trim() || category || freeOnly || when !== "any");
  const [lead, ...rest] = results;

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active
        ? "border-purple bg-purple text-white"
        : "border-line bg-card text-ink-2 hover:border-ink-3"
    }`;

  return (
    <main className="wd-night min-h-screen bg-cream">
      <header className="border-b border-line bg-cream">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-4xl">
          Wetin dey?
        </h1>
        <p className="mt-1 text-ink-2">
          Everything happening around campus, in one place.
        </p>

        {/* Search is the primary control, so it gets the width. */}
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events, venues, departments…"
            aria-label="Search events"
            className="w-full rounded-xl border border-line bg-card py-3 pl-10 pr-3 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>

        {/* Filters in one row above the results, scrollable on a phone. */}
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <button onClick={() => setCategory(null)} className={chip(category === null)}>
            All
          </button>
          {data?.categories.map((c) => (
            <button
              key={c.name}
              onClick={() => setCategory(c.name === category ? null : c.name)}
              className={chip(category === c.name)}
            >
              {c.name}
              <span className="ml-1.5 opacity-60">{c.count}</span>
            </button>
          ))}
        </div>

        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {WHEN.map((w) => (
            <button key={w.key} onClick={() => setWhen(w.key)} className={chip(when === w.key)}>
              {w.label}
            </button>
          ))}
          <button onClick={() => setFreeOnly((v) => !v)} className={chip(freeOnly)}>
            Free
          </button>
        </div>

        {/* ── Results ─────────────────────────────────────────────────── */}
        {loading ? (
          <p className="mt-10 text-ink-3">Loading…</p>
        ) : results.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-line bg-card p-8 text-center">
            <p className="text-lg font-bold text-ink">
              {filtering ? "Nothing match that search." : "Nothing dey here yet."}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {filtering
                ? "Try a different word, or clear the filters."
                : "When societies start posting, this is where it shows up."}
            </p>
            {filtering && (
              <button
                onClick={() => {
                  setQ("");
                  setCategory(null);
                  setWhen("any");
                  setFreeOnly(false);
                }}
                className="mt-4 rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple-deep"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mt-8 text-sm text-ink-3">
              {results.length} {results.length === 1 ? "event" : "events"}
            </p>

            {/* One lead item, then a grid — so the page has a shape rather
                than being an undifferentiated wall of rectangles. */}
            <div className="mt-4">
              <FeaturedCard e={lead} />
            </div>

            {rest.length > 0 && (
              <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                {rest.map((e) => (
                  <EventCardItem key={e.id} e={e} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
