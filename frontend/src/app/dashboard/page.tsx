"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowRight,
  BarChart3,
  Check,
  CreditCard,
  QrCode,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

interface EventSummary {
  id: string;
  title: string;
  slug: string;
  startDatetime: string;
  status: string;
}

interface EventMetrics {
  ticketsSold: number;
  ticketsTotal: number;
  revenue: number;
  checkedIn: number;
  eventTitle: string;
  ticketBreakdown: Array<{
    tier: string;
    sold: number;
    remaining: number;
    revenue: number;
  }>;
}

const naira = (value: number) =>
  `₦${Math.round(value).toLocaleString("en-NG")}`;

export default function DashboardPage() {
  const { data: session } = useSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch("/api/dashboard/events");
        const data = await response.json();
        if (Array.isArray(data.events) && data.events.length > 0) {
          setEvents(data.events);
          setSelectedEventId(data.events[0].id);
        }
      } catch (error) {
        console.error("Failed to fetch events:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;

    const fetchMetrics = async () => {
      setMetricsLoading(true);
      try {
        const response = await fetch(
          `/api/dashboard/metrics?eventId=${selectedEventId}`
        );
        const data = await response.json();
        setMetrics(response.ok ? data : null);
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
        setMetrics(null);
      } finally {
        setMetricsLoading(false);
      }
    };

    fetchMetrics();
  }, [selectedEventId]);

  const firstName = session?.user?.name?.trim().split(" ")[0];
  const selectedEvent = events.find((e) => e.id === selectedEventId);

  const hasEvent = events.length > 0;
  const hasPublished = events.some((e) => e.status === "published");
  const hasSale = (metrics?.ticketsSold ?? 0) > 0;

  const steps = [
    {
      done: hasEvent,
      title: "Create your first event",
      body: "Name it, set the date, add your ticket tiers.",
      cta: "Create event",
      href: "/dashboard/events/new",
    },
    {
      done: hasPublished,
      title: "Publish it",
      body: "Publishing gives you a public link people can buy from.",
      cta: "Go to events",
      href: "/dashboard/events",
    },
    {
      done: hasSale,
      title: "Make your first sale",
      body: "Share your event link — every ticket gets a scannable QR.",
      cta: selectedEvent ? "View public page" : "Go to events",
      href: selectedEvent ? `/events/${selectedEvent.slug}` : "/dashboard/events",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const setupComplete = doneCount === steps.length;

  const soldPct =
    metrics && metrics.ticketsTotal > 0
      ? Math.min(100, Math.round((metrics.ticketsSold / metrics.ticketsTotal) * 100))
      : 0;
  const checkedInPct =
    metrics && metrics.ticketsSold > 0
      ? Math.round((metrics.checkedIn / metrics.ticketsSold) * 100)
      : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-surface" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <section>
        <h1 className="text-3xl font-bold tracking-tight text-on-dark">
          Hey {firstName || "there"} <span aria-hidden>👋</span>
        </h1>
        <p className="mt-1 text-on-dark-2">
          Here&apos;s your money and what&apos;s next.
        </p>
      </section>

      {/* Setup checklist */}
      {!setupComplete && (
        <section className="rounded-2xl border border-line-dark bg-surface p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-on-dark">Get set up</h2>
              <p className="text-sm text-on-dark-2">
                A few quick steps and you&apos;re selling.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-line-dark px-3 py-1 text-sm font-medium text-on-dark-2">
              {doneCount}/{steps.length} done
            </span>
          </div>

          <ol className="space-y-3">
            {steps.map((step) => (
              <li
                key={step.title}
                className="flex flex-col gap-3 rounded-xl border border-line-dark bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      step.done
                        ? "border-gold bg-gold text-canvas"
                        : "border-line-dark text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <div>
                    <p
                      className={`font-semibold ${
                        step.done ? "text-on-dark-3 line-through" : "text-on-dark"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-sm text-on-dark-2">{step.body}</p>
                  </div>
                </div>

                {!step.done && (
                  <Link
                    href={step.href}
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-gold px-3.5 py-2 text-sm font-semibold text-canvas transition-colors hover:bg-gold-deep sm:self-auto"
                  >
                    {step.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Event switcher */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <label
            htmlFor="event-switcher"
            className="mb-1.5 block text-sm text-on-dark-2"
          >
            Showing numbers for
          </label>
          {hasEvent ? (
            <select
              id="event-switcher"
              value={selectedEventId ?? ""}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="rounded-lg border border-line-dark bg-surface px-3.5 py-2.5 font-semibold text-on-dark focus:outline-none focus:ring-2 focus:ring-gold"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-semibold text-on-dark-3">No events yet</p>
          )}
        </div>

        <Link
          href="/dashboard/events/new"
          className="inline-flex items-center gap-2 self-start rounded-lg bg-gold px-4 py-2.5 font-semibold text-canvas transition-colors hover:bg-gold-deep"
        >
          <Ticket className="h-4 w-4" />
          Create event
        </Link>
      </section>

      {!hasEvent ? (
        <section className="rounded-2xl border border-line-dark bg-surface p-12 text-center">
          <Ticket className="mx-auto mb-4 h-10 w-10 text-gold" />
          <h2 className="mb-1 text-xl font-bold text-on-dark">
            Your numbers land here
          </h2>
          <p className="mx-auto mb-6 max-w-sm text-on-dark-2">
            Create an event and this page fills up with sales, revenue and
            check-ins as they happen.
          </p>
          <Link
            href="/dashboard/events/new"
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 font-semibold text-canvas transition-colors hover:bg-gold-deep"
          >
            Create your first event
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      ) : metricsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : metrics ? (
        <>
          {/* Metrics */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-line-dark bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-on-dark-2">Tickets sold</p>
                <Ticket className="h-4 w-4 text-on-dark-3" />
              </div>
              <p className="text-3xl font-bold text-on-dark">
                {metrics.ticketsSold}
                <span className="ml-1 text-base font-medium text-on-dark-3">
                  / {metrics.ticketsTotal}
                </span>
              </p>
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-canvas"
                role="img"
                aria-label={`${soldPct}% of tickets sold`}
              >
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${soldPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-line-dark bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-on-dark-2">Revenue</p>
                <TrendingUp className="h-4 w-4 text-on-dark-3" />
              </div>
              <p className="text-3xl font-bold text-gold">
                {naira(metrics.revenue)}
              </p>
              <p className="mt-3 text-xs text-on-dark-3">Paid orders only</p>
            </div>

            <div className="rounded-2xl border border-line-dark bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-on-dark-2">Checked in</p>
                <QrCode className="h-4 w-4 text-on-dark-3" />
              </div>
              <p className="text-3xl font-bold text-on-dark">{metrics.checkedIn}</p>
              <p className="mt-3 text-xs text-on-dark-3">
                {checkedInPct}% of tickets sold
              </p>
            </div>

            <div className="rounded-2xl border border-line-dark bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-on-dark-2">
                  Still available
                </p>
                <BarChart3 className="h-4 w-4 text-on-dark-3" />
              </div>
              <p className="text-3xl font-bold text-on-dark">
                {Math.max(0, metrics.ticketsTotal - metrics.ticketsSold)}
              </p>
              <p className="mt-3 text-xs text-on-dark-3">Across all tiers</p>
            </div>
          </section>

          {/* Breakdown */}
          <section className="overflow-hidden rounded-2xl border border-line-dark bg-surface">
            <div className="border-b border-line-dark px-6 py-4">
              <h2 className="font-bold text-on-dark">Ticket breakdown</h2>
            </div>

            {metrics.ticketBreakdown.length === 0 ? (
              <p className="px-6 py-8 text-center text-on-dark-2">
                No ticket tiers on this event yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-canvas text-xs uppercase tracking-wide text-on-dark-3">
                      <th className="px-6 py-3 font-semibold">Tier</th>
                      <th className="px-6 py-3 text-right font-semibold">Sold</th>
                      <th className="px-6 py-3 text-right font-semibold">
                        Remaining
                      </th>
                      <th className="px-6 py-3 text-right font-semibold">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-dark">
                    {metrics.ticketBreakdown.map((row) => (
                      <tr key={row.tier}>
                        <td className="px-6 py-4 font-medium text-on-dark">
                          {row.tier}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums text-on-dark-2">
                          {row.sold}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums text-on-dark-2">
                          {row.remaining}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold tabular-nums text-gold">
                          {naira(row.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Quick actions */}
          <section>
            <h2 className="mb-4 font-bold text-on-dark">Event tools</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  href: `/dashboard/events/${selectedEventId}/attendees`,
                  icon: Users,
                  title: "Attendees",
                  body: "Search and manage the guest list",
                },
                {
                  href: `/dashboard/events/${selectedEventId}/check-in`,
                  icon: QrCode,
                  title: "Check-in",
                  body: "Scan tickets at the gate",
                },
                {
                  href: `/dashboard/events/${selectedEventId}/payouts`,
                  icon: Wallet,
                  title: "Payouts",
                  body: "Track what lands in your bank",
                },
                {
                  href: `/dashboard/events/${selectedEventId}/team`,
                  icon: UserPlus,
                  title: "Team",
                  body: "Invite staff and set roles",
                },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group rounded-2xl border border-line-dark bg-surface p-5 transition-colors hover:border-gold hover:bg-surface-2"
                >
                  <action.icon className="mb-3 h-6 w-6 text-gold" />
                  <p className="font-semibold text-on-dark">{action.title}</p>
                  <p className="mt-1 text-sm text-on-dark-2">{action.body}</p>
                </Link>
              ))}
            </div>
          </section>

          {selectedEvent && (
            <section className="flex flex-col gap-3 rounded-2xl border border-line-dark bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                <div>
                  <p className="font-semibold text-on-dark">
                    Share your event link
                  </p>
                  <p className="text-sm text-on-dark-2">
                    This is the page your buyers see.
                  </p>
                </div>
              </div>
              <Link
                href={`/events/${selectedEvent.slug}`}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark transition-colors hover:border-gold hover:text-gold sm:self-auto"
              >
                View public page
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          )}
        </>
      ) : (
        <section className="rounded-2xl border border-line-dark bg-surface p-8 text-center">
          <p className="text-on-dark-2">
            Couldn&apos;t load metrics for this event. Try again in a moment.
          </p>
        </section>
      )}
    </div>
  );
}
