'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Ticket, CalendarPlus, UserPlus } from 'lucide-react';
import { naira, PLATFORM_FEE_RATE } from '@/lib/fees';

/**
 * Platform overview.
 *
 * The previous version opened with four equal-weight KPI tiles — including a
 * check-in rate of 0.00% for events that had not happened yet — and a badge
 * announcing that it refreshed every thirty seconds. That is the shape of a
 * dashboard for a platform with thousands of events, worn by one with five.
 * It reported size and told you nothing about what was going on.
 *
 * This leads with the one number that is actually the platform's business,
 * then what needs a human, then what has happened, with the totals kept
 * deliberately quiet at the bottom. The revenue chart only appears once there
 * is something to plot; a line through thirteen zeroes and one spike is
 * decoration, not information.
 */

interface Metrics {
  overview: { totalEvents: number; activeEvents: number; totalOrganizers: number; totalAttendees: number };
  financial: { totalRevenue: number; paidOrders: number; ticketValue: number; platformEarnings: number; organizerPayouts: number; recentRevenue: number; averageDailyRevenue: string };
  engagement: { checkedInAttendees: number; checkInRate: string; totalAttendees: number };
}

type Activity = {
  items: { kind: 'sale' | 'event' | 'signup'; at: string; title: string; detail: string }[];
  needsYou: { label: string; href: string }[];
};

type Daily = { date: string; revenue: number; orders: number; platformFee: number };

const ICONS = { sale: Ticket, event: CalendarPlus, signup: UserPlus } as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * Platform earnings over time. One series, so no legend — the heading names
 * it. Recessive grid, 2px line, the endpoint emphasised and directly
 * labelled rather than a number on every point.
 */
function EarningsChart({ data }: { data: Daily[] }) {
  // Drawn on the indigo panel, so the line takes the lifted purple that
  // holds up on dark; the same #6C3CFF used on white would go muddy here.
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 160;
  const PAD = { top: 16, right: 16, bottom: 22, left: 16 };
  const max = Math.max(...data.map((d) => d.platformFee), 1);
  const stepX = (W - PAD.left - PAD.right) / Math.max(data.length - 1, 1);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const x = (i: number) => PAD.left + i * stepX;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.platformFee)}`).join(' ');
  const area = `${line} L ${x(data.length - 1)} ${H - PAD.bottom} L ${x(0)} ${H - PAD.bottom} Z`;
  const last = data[data.length - 1];
  const active = hover === null ? data.length - 1 : hover;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Platform earnings per day, ending at ${naira(last.platformFee)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round((rel - PAD.left) / stepX);
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        <line
          x1={PAD.left} x2={W - PAD.right}
          y1={H - PAD.bottom} y2={H - PAD.bottom}
          stroke="var(--color-indigo-line)" strokeWidth="1"
        />
        <path d={area} fill="var(--color-purple-lift)" opacity="0.18" />
        <path d={line} fill="none" stroke="var(--color-purple-lift)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
        {hover !== null && (
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="var(--color-on-dark-3)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        <circle cx={x(active)} cy={y(data[active].platformFee)} r="5"
          fill="var(--color-purple-lift)" stroke="var(--color-indigo)" strokeWidth="2" />
        <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--color-on-dark-3)">
          {new Date(data[0].date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize="11" textAnchor="end" fill="var(--color-on-dark-3)">
          {new Date(last.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
        </text>
      </svg>
      <figcaption className="mt-1 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
        {new Date(data[active].date).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}
        {' · '}
        <span className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
          {naira(data[active].platformFee)}
        </span>
        {data[active].orders > 0 && ` from ${data[active].orders} ${data[active].orders === 1 ? 'order' : 'orders'}`}
      </figcaption>
    </figure>
  );
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [name, setName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [m, a, an, s] = await Promise.all([
        fetch('/api/admin/metrics').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/admin/activity').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/admin/analytics?days=14').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/auth/session').then((r) => r.json()).catch(() => null),
      ]);
      setMetrics(m);
      setActivity(a);
      setDaily(an?.dailyRevenue ?? []);
      setName((s?.user?.name ?? '').split(' ')[0] ?? '');
      setLoading(false);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const handleExport = async (type: 'events' | 'financials' | 'attendees') => {
    setExporting(true);
    try {
      const response = await fetch(`/api/admin/export?format=csv&type=${type}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // A chart needs something to show. Below three days with any money on them
  // it is a flat line with one spike, which reads as "broken" rather than
  // "early".
  const chartWorthShowing = useMemo(
    () => daily.filter((d) => d.platformFee > 0).length >= 3,
    [daily]
  );

  if (loading) {
    return <p className="mx-auto max-w-5xl px-4 py-16 sm:px-6" style={{ color: 'var(--color-stone)' }}>Loading…</p>;
  }
  if (!metrics) {
    return <p className="mx-auto max-w-5xl px-4 py-16 sm:px-6" style={{ color: 'var(--color-danger)' }}>Couldn&apos;t load the dashboard.</p>;
  }

  const { overview, financial } = metrics;
  const earned = financial.platformEarnings;
  const ticketValue = financial.ticketValue ?? 0;
  const sold = overview.totalAttendees;
  const ratePercent = Math.round(PLATFORM_FEE_RATE * 100);

  // Orders keep whatever fee they were charged, so historic sales can sit at
  // an older rate. Say so rather than letting the numbers look wrong.
  const effectiveRate = ticketValue > 0 ? earned / ticketValue : PLATFORM_FEE_RATE;
  const mixedRates = Math.abs(effectiveRate - PLATFORM_FEE_RATE) > 0.001;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-forest)' }}>
            {greeting()}{name ? `, ${name}` : ''}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-stone)' }}>
            {sold === 0
              ? 'No tickets sold yet. The first one is the hard one.'
              : `${sold} ${sold === 1 ? 'ticket' : 'tickets'} sold across ${overview.totalEvents} ${overview.totalEvents === 1 ? 'event' : 'events'}.`}
          </p>
        </div>
        <button
          onClick={() => handleExport('financials')}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-purple)' }}
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {/* ── The money ──────────────────────────────────────────────────
          A dark indigo panel, and the only one on the page. The build
          document puts indigo on "hero areas" for a reason: a white card with
          black numbers on an off-white page has nothing to say, and this is
          the one section that should feel like something. Everything else
          stays light so this reads as the anchor rather than as noise. */}
      <section
        className="relative mt-6 overflow-hidden rounded-2xl p-6 sm:p-8"
        style={{ backgroundColor: 'var(--color-indigo)' }}
      >
        {/* The brand's question mark, used once and quietly. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none text-[9rem] font-extrabold leading-none sm:right-6 sm:text-[12rem]"
          style={{ color: 'var(--color-purple-lift)', opacity: 0.14 }}
        >
          ?
        </span>

        <div className="relative">
          <p
            className="text-xs font-bold uppercase tracking-[0.12em]"
            style={{ color: 'var(--color-purple-lift)' }}
          >
            Platform earnings
          </p>
          <p
            className="mt-2 text-5xl font-extrabold tracking-[-0.03em] tabular-nums"
            style={{ color: 'var(--color-on-dark)' }}
          >
            {naira(earned)}
          </p>

          {ticketValue > 0 ? (
            <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
              Your cut of {naira(ticketValue)} in ticket sales. Organisers kept{' '}
              {naira(financial.organizerPayouts)}.
            </p>
          ) : (
            <p className="mt-2 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
              You take {ratePercent}% of every ticket sold.
            </p>
          )}

          {mixedRates && (
            <p className="mt-2 max-w-md text-xs" style={{ color: 'var(--color-on-dark-3)' }}>
              Includes sales made at older rates — each order keeps the fee it
              was charged, so this figure never rewrites itself when you change
              your rate.
            </p>
          )}

          <div className="mt-6">
            {chartWorthShowing ? (
              <EarningsChart data={daily} />
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-on-dark-3)' }}>
                A chart appears here once there are sales on a few different
                days — right now it would be a flat line with one bump.
              </p>
            )}
          </div>

          {/* Supporting figures, on their own line under a hairline so they
              read as context for the number above rather than rivals to it. */}
          <dl
            className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t pt-5"
            style={{ borderColor: 'var(--color-indigo-line)' }}
          >
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--color-on-dark-3)' }}>
                Volume processed
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums" style={{ color: 'var(--color-on-dark)' }}>
                {naira(financial.totalRevenue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--color-on-dark-3)' }}>
                Paid orders
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums" style={{ color: 'var(--color-on-dark)' }}>
                {financial.paidOrders ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--color-on-dark-3)' }}>
                Average order
              </dt>
              <dd className="mt-1 text-xl font-bold tabular-nums" style={{ color: 'var(--color-on-dark)' }}>
                {naira(
                  (financial.paidOrders ?? 0) > 0
                    ? Math.round((financial.totalRevenue / (financial.paidOrders ?? 1)) * 100) / 100
                    : 0
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── What needs a person ───────────────────────────────────────── */}
      {activity && activity.needsYou.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-stone-mid)' }}>
            Needs you
          </h2>
          <ul className="mt-3 space-y-2">
            {activity.needsYou.map((n) => (
              <li key={n.href + n.label}>
                <Link
                  href={n.href}
                  className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 transition-colors hover:border-purple"
                  style={{ borderColor: 'var(--color-line)' }}
                >
                  <span style={{ color: 'var(--color-forest)' }}>{n.label}</span>
                  <ArrowRight className="h-4 w-4" style={{ color: 'var(--color-purple)' }} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* ── What has happened ──────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-stone-mid)' }}>
            Lately
          </h2>
          {activity && activity.items.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {activity.items.map((item, i) => {
                const Icon = ICONS[item.kind];
                return (
                  <li key={`${item.at}-${i}`} className="flex items-start gap-3 py-2">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: 'var(--color-purple-soft)' }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-purple)' }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium" style={{ color: 'var(--color-forest)' }}>
                        {item.title}
                      </span>
                      <span className="block truncate text-xs" style={{ color: 'var(--color-stone-mid)' }}>
                        {item.detail} · {timeAgo(item.at)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-stone)' }}>
              Nothing yet. Sales, new events and signups will show up here as
              they happen.
            </p>
          )}
        </section>

        {/* ── Totals, kept quiet ─────────────────────────────────────── */}
        <aside>
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-stone-mid)' }}>
            All time
          </h2>
          <dl className="mt-3 rounded-xl border bg-white" style={{ borderColor: 'var(--color-line)' }}>
            {[
              ['Events', `${overview.totalEvents}`, `${overview.activeEvents} live`],
              ['Organisers', `${overview.totalOrganizers}`, ''],
              ['Tickets issued', `${overview.totalAttendees}`, ''],
              ['Checked in', `${metrics.engagement.checkedInAttendees}`, ''],
            ].map(([label, value, note], i) => (
              <div
                key={label}
                className="flex items-baseline justify-between px-4 py-3"
                style={{ borderTop: i === 0 ? undefined : '1px solid var(--color-line)' }}
              >
                <dt className="text-sm" style={{ color: 'var(--color-stone)' }}>{label}</dt>
                <dd className="text-right">
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--color-forest)' }}>{value}</span>
                  {note && <span className="ml-2 text-xs" style={{ color: 'var(--color-stone-mid)' }}>{note}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-col gap-2">
            <Link href="/admin/events" className="text-sm font-semibold" style={{ color: 'var(--color-purple)' }}>
              Manage events →
            </Link>
            <Link href="/admin/analytics" className="text-sm font-semibold" style={{ color: 'var(--color-purple)' }}>
              Analytics →
            </Link>
            <Link href="/admin/departments" className="text-sm font-semibold" style={{ color: 'var(--color-purple)' }}>
              Departments →
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
