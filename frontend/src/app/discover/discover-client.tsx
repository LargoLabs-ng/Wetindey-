"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { AccountNav } from "@/components/account-nav";
import { EventCardItem, FeaturedCard, type CardEvent } from "@/components/event-card";

type Payload = { events: CardEvent[]; categories: { name: string; count: number }[] };

const WHEN = [
  { key: "any", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This weekend" },
  { key: "month", label: "This month" },
] as const;

type WhenKey = (typeof WHEN)[number]["key"];

const WHEN_KEYS = WHEN.map((w) => w.key) as readonly string[];

/**
 * Where Discover remembers the scroll position when someone opens an
 * event, so Back lands them on the same card rather than the top of the
 * list. One entry, cleared once used.
 */
const RETURN_KEY = "wd-discover-return";

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

/**
 * Discover.
 *
 * Search and filters live in the web address (?q=…&category=…&when=…&free=1)
 * rather than only in memory. That is what makes Back from an event come
 * back to the same results, and it makes a filtered view something you can
 * copy and share. Changes replace the current history entry instead of
 * adding one, so Back still leaves Discover in one step.
 */
export default function DiscoverClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  // The address is the source of truth for the filters.
  const category = params.get("category") || null;
  const whenParam = params.get("when") ?? "any";
  const when: WhenKey = WHEN_KEYS.includes(whenParam) ? (whenParam as WhenKey) : "any";
  const freeOnly = params.get("free") === "1";
  const urlQ = params.get("q") ?? "";

  // Typing updates the box (and the results) straight away and the address
  // a moment later, so the address bar isn't rewritten on every keystroke.
  // If the address changes some other way — the Discover link, Back — the
  // box follows it.
  const [q, setQ] = useState(urlQ);
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    setQ(urlQ);
  }

  /**
   * The filters we most recently asked the router for.
   *
   * router.replace() doesn't update the address bar straight away, so two
   * quick changes (type a search, then tap a chip) both read the OLD address
   * and the second wipes out the first. Building every change on top of the
   * last one we asked for, not on what the address bar says right now, keeps
   * both. When the address changes for any other reason (the Discover link,
   * Back), it's taken as the new starting point.
   */
  const wanted = useRef(params.toString());
  const asked = useRef(new Set<string>());
  const paramsKey = params.toString();
  useEffect(() => {
    if (asked.current.has(paramsKey)) {
      asked.current.delete(paramsKey);
      return;
    }
    wanted.current = paramsKey;
  }, [paramsKey]);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(wanted.current);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      wanted.current = query;
      asked.current.add(query);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setQ(value);
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => {
      typing.current = null;
      setParams({ q: value.trim() || null });
    }, 300);
  };
  useEffect(
    () => () => {
      if (typing.current) clearTimeout(typing.current);
    },
    []
  );

  // Tapping a chip also saves whatever is in the search box right now, so a
  // search typed a split second earlier is never lost.
  const withSearch = (patch: Record<string, string | null>) => {
    if (typing.current) {
      clearTimeout(typing.current);
      typing.current = null;
    }
    setParams({ q: q.trim() || null, ...patch });
  };
  const setCategory = (value: string | null) => withSearch({ category: value });
  const setWhen = (value: WhenKey) => withSearch({ when: value === "any" ? null : value });
  const toggleFree = () => withSearch({ free: freeOnly ? null : "1" });
  const clearAll = () => {
    if (typing.current) clearTimeout(typing.current);
    typing.current = null;
    setQ("");
    wanted.current = "";
    asked.current.add("");
    router.replace(pathname, { scroll: false });
  };

  useEffect(() => {
    fetch("/api/discover")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ events: [], categories: [] }))
      .finally(() => setLoading(false));
  }, []);

  // Coming back from an event: once the cards are on the page again, put
  // the reader back where they were. Only for the exact view they left.
  useEffect(() => {
    if (loading) return;
    let saved: { url: string; y: number } | null = null;
    try {
      saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null");
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch {
      saved = null;
    }
    const here = `${window.location.pathname}${window.location.search}`;
    if (saved && saved.url === here && saved.y > 0) {
      requestAnimationFrame(() => window.scrollTo(0, saved!.y));
    }
  }, [loading]);

  const rememberPlace = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("a")) return;
    try {
      window.sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({
          url: `${window.location.pathname}${window.location.search}`,
          y: window.scrollY,
        })
      );
    } catch {
      // Private mode or storage full: Back still works, just from the top.
    }
  };

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
          <AccountNav />
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
            onChange={(e) => onSearch(e.target.value)}
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
          <button onClick={toggleFree} className={chip(freeOnly)}>
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
                onClick={clearAll}
                className="mt-4 rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple-deep"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div onClickCapture={rememberPlace}>
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
          </div>
        )}
      </div>
    </main>
  );
}
