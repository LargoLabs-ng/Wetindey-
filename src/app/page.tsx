"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { EventRail, FeaturedCard, type CardEvent } from "@/components/event-card";

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
export default function HomePage() {
  const [events, setEvents] = useState<CardEvent[] | null>(null);

  useEffect(() => {
    fetch("/api/discover")
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, []);

  const now = Date.now();
  const soon = (events ?? []).filter(
    (e) => new Date(e.startDatetime).getTime() - now < 14 * 86400000
  );
  const justDropped = [...(events ?? [])]
    .sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1))
    .slice(0, 8);
  const free = (events ?? []).filter((e) => e.isFree);
  const lead = (events ?? [])[0];

  return (
    <div className="min-h-screen bg-cream">
      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-purple px-3.5 py-2 text-sm font-semibold text-white hover:bg-purple-deep"
            >
              Sign up
            </Link>
          </nav>
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
              href="/signup"
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
        {events === null ? (
          <p className="pt-12 text-ink-3">Loading what&apos;s on…</p>
        ) : events.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-line bg-white p-10 text-center">
            <p className="text-xl font-extrabold text-ink">Nothing dey here yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-ink-2">
              No events posted yet. If you&apos;re running something, you can be
              the first — it takes about two minutes.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-block rounded-lg bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-deep"
            >
              Post your event
            </Link>
          </div>
        ) : (
          <>
            {lead && (
              <section className="pt-12">
                <h2 className="mb-4 text-lg font-extrabold tracking-[-0.02em] text-ink">
                  Next one up
                </h2>
                <FeaturedCard e={lead} />
              </section>
            )}

            <EventRail
              title="Happening soon"
              note="In the next two weeks"
              events={soon}
              href="/discover"
            />
            <EventRail title="Just dropped" events={justDropped} href="/discover" />
            <EventRail
              title="Free entry"
              note="No ticket money required"
              events={free}
              href="/discover"
            />

            <div className="mt-12 text-center">
              <Link
                href="/discover"
                className="inline-block rounded-xl border border-line bg-white px-6 py-3 font-semibold text-ink hover:border-ink-3"
              >
                See everything
              </Link>
            </div>
          </>
        )}
      </div>

      {/* ── For organisers, kept to its proper size ───────────────────── */}
      <section className="border-y border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-ink">
              Running something?
            </h2>
            <p className="mt-1 max-w-md text-ink-2">
              Set your tiers, share one link, scan people in at the door. You
              keep the ticket price; we take 5%.
            </p>
          </div>
          <Link
            href="/signup"
            className="shrink-0 rounded-xl bg-purple px-5 py-3 font-semibold text-white hover:bg-purple-deep"
          >
            Post an event
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <WordMark asLink={false} />
          <p className="text-sm text-ink-3">Calabar, Nigeria</p>
        </div>
        <p className="mt-6 text-sm text-ink-3">
          © {new Date().getFullYear()} Wetin Dey. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
