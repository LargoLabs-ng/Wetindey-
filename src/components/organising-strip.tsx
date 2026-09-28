"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

export type OrganisedEvent = {
  id: string;
  title: string;
  slug: string;
  startDatetime: string;
  /**
   * The date is unconfirmed publicly. The organiser still sees their own
   * working date here — the flag hides it from buyers, not from the person
   * who set it — but it's marked, so one glance down this strip shows which
   * events still need pinning down.
   */
  dateTbd?: boolean;
  status: string;
  role: string;
  sold: number;
  capacity: number;
  href: string;
};

/**
 * "Organising" — the events you run, above everything else on the home page.
 *
 * Not a consumer card, on purpose. A poster with a price on it answers
 * "do I want to go to this?", which is not a question you have about your
 * own event. What an organiser wants at a glance is whether it is live, how
 * many have bought, and how long they have left — so that is what the card
 * says, and the artwork stays out of the way.
 */
export function OrganisingStrip() {
  const [events, setEvents] = useState<OrganisedEvent[] | null>(null);

  useEffect(() => {
    fetch("/api/organising")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]));
  }, []);

  // Nothing at all for a student with no events — no heading, no empty state,
  // no hint that a part of the product is being withheld from them.
  if (!events || events.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
            Organising
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">
            {events.length === 1 ? "Your event" : `Your ${events.length} events`}
          </p>
        </div>
        <Link
          href="/dashboard/events"
          className="shrink-0 text-sm font-semibold text-purple hover:underline"
        >
          All of them →
        </Link>
      </div>

      <div className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {events.map((e) => (
          <OrganiserCard key={e.id} e={e} />
        ))}

        {/* The old nav's one organiser action, kept but demoted to where it
            belongs: after the events you already have, not instead of them. */}
        <Link
          href="/dashboard/events/new"
          className="flex w-[52vw] max-w-[220px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 p-5 text-center text-sm font-semibold text-ink-2 transition-colors hover:border-purple hover:text-purple sm:w-52"
        >
          <Plus className="h-5 w-5" />
          New event
        </Link>
      </div>
    </section>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-cream-3 text-ink-2" },
  published: { label: "Live", className: "text-white" },
  unpublished: { label: "Hidden", className: "bg-warn-soft text-warn" },
  cancelled: { label: "Cancelled", className: "bg-bad-soft text-bad" },
};

function countdown(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return "Happened";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
  });
}

function OrganiserCard({ e }: { e: OrganisedEvent }) {
  const status = STATUS[e.status] ?? STATUS.draft;
  const live = e.status === "published";
  const pct = e.capacity > 0 ? Math.min(100, (e.sold / e.capacity) * 100) : 0;

  return (
    <Link
      href={e.href}
      className="flex w-[70vw] max-w-[280px] shrink-0 flex-col rounded-2xl border border-line bg-card p-4 transition-colors hover:border-ink-3 sm:w-64"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${status.className}`}
          style={live ? { backgroundColor: "var(--color-ok)" } : undefined}
        >
          {status.label}
        </span>
        <span className="text-xs font-semibold text-ink-3">
          {e.dateTbd
            ? `${countdown(e.startDatetime)} · TBA`
            : countdown(e.startDatetime)}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 font-extrabold leading-snug tracking-[-0.01em] text-ink">
        {e.title}
      </h3>

      {/* Sold against capacity, as a number and a bar. An organiser checking
          their phone between lectures reads the bar; the number is there for
          when the bar is not precise enough. */}
      {e.capacity > 0 ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-ink">
              {e.sold} <span className="font-normal text-ink-3">sold</span>
            </span>
            <span className="text-ink-3">{e.capacity} total</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-cream-3">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: "var(--color-purple)",
              }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-3">No tickets on sale yet</p>
      )}

      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-purple">
        {/* The label says where it goes. Gate staff get the scanner rather
            than a management page they are not allowed to open. */}
        {e.href.startsWith("/checkin") ? "Open scanner" : "Manage"}
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
