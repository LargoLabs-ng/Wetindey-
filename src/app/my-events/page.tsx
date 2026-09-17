"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CalendarDays, MapPin, QrCode, Ticket } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { EventImage } from "@/components/event-image";

const QRCodeDisplay = dynamic(
  () => import("@/components/qr-code-display").then((m) => m.QRCodeDisplay),
  { ssr: false }
);

type Item = {
  ticketId: string;
  qrToken: string;
  status: string;
  attendeeName: string;
  attendeeEmail: string;
  tierName: string;
  checkedInAt: string | null;
  event: {
    id: string;
    slug: string;
    title: string;
    coverImage: string | null;
    venueName: string | null;
    city: string | null;
    startDatetime: string;
    endDatetime: string;
  };
};

function TicketRow({ item, past }: { item: Item; past: boolean }) {
  const [showQR, setShowQR] = useState(false);
  const start = new Date(item.event.startDatetime);
  const place = [item.event.venueName, item.event.city].filter(Boolean).join(", ");
  const used = item.status === "checked_in";

  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex gap-4 p-4">
        <Link
          href={`/events/${item.event.slug}`}
          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-indigo-2"
        >
          {item.event.coverImage && (
            <EventImage src={item.event.coverImage} alt={item.event.title} sizes="80px" />
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <Link href={`/events/${item.event.slug}`}>
            <h3 className="truncate font-bold tracking-[-0.01em] text-ink">
              {item.event.title}
            </h3>
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {start.toLocaleDateString("en-NG", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            {" · "}
            {start.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}
          </p>
          {place && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-ink-3">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {place}
            </p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-cream-2 px-2 py-0.5 text-xs font-semibold text-ink-2">
              {item.tierName}
            </span>
            {used && (
              <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                Checked in
              </span>
            )}
          </p>
        </div>

        {!past && !used && (
          <button
            type="button"
            onClick={() => setShowQR((v) => !v)}
            className="shrink-0 self-start rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-ink-3"
          >
            <QrCode className="mx-auto h-4 w-4" />
            <span className="mt-0.5 block text-[11px]">{showQR ? "Hide" : "Show"}</span>
          </button>
        )}
      </div>

      {showQR && (
        <div className="border-t border-line bg-cream-2 px-4 py-5">
          <QRCodeDisplay
            token={item.qrToken}
            ticketId={item.ticketId}
            attendeeName={item.attendeeName}
            attendeeEmail={item.attendeeEmail}
            eventTitle={item.event.title}
          />
        </div>
      )}
    </li>
  );
}

export default function MyEventsPage() {
  const [data, setData] = useState<{ upcoming: Item[]; past: Item[] } | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    fetch("/api/tickets/mine")
      .then((r) => {
        if (r.status === 401) {
          setSignedOut(true);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setData({ upcoming: [], past: [] }));
  }, []);

  return (
    <div className="wd-night min-h-screen bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <div className="flex items-center gap-3">
            <Link href="/discover" className="text-sm font-semibold text-ink-2 hover:text-ink">
              Discover
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink">My events</h1>

        {signedOut ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-8 text-center">
            <p className="text-lg font-bold text-ink">Sign in to see your tickets</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
              Bought as a guest? You don&apos;t need an account — we can email
              your tickets again instead.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link
                href="/login?callbackUrl=/my-events"
                className="rounded-lg bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-deep"
              >
                Sign in
              </Link>
              <Link
                href="/tickets/recover"
                className="rounded-lg border border-line bg-card px-5 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
              >
                Email me my tickets
              </Link>
            </div>
          </div>
        ) : !data ? (
          <p className="mt-6 text-ink-3">Loading…</p>
        ) : data.upcoming.length === 0 && data.past.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-8 text-center">
            <Ticket className="mx-auto h-8 w-8 text-ink-3" />
            <p className="mt-3 text-lg font-bold text-ink">No tickets yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
              Anything you grab shows up here. If you bought something before
              making this account, we can email those tickets to you instead.
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link
                href="/discover"
                className="rounded-lg bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-deep"
              >
                See wetin dey
              </Link>
              <Link
                href="/tickets/recover"
                className="rounded-lg border border-line bg-card px-5 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
              >
                Find an older ticket
              </Link>
            </div>
          </div>
        ) : (
          <>
            {data.upcoming.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink-3">
                  Coming up
                </h2>
                <ul className="mt-3 space-y-3">
                  {data.upcoming.map((i) => (
                    <TicketRow key={i.ticketId} item={i} past={false} />
                  ))}
                </ul>
              </section>
            )}

            {data.past.length > 0 && (
              <section className="mt-10">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink-3">
                  Been there
                </h2>
                <ul className="mt-3 space-y-3 opacity-75">
                  {data.past.map((i) => (
                    <TicketRow key={i.ticketId} item={i} past />
                  ))}
                </ul>
              </section>
            )}

            <p className="mt-8 text-center text-sm text-ink-3">
              Missing something you bought as a guest?{" "}
              <Link href="/tickets/recover" className="font-semibold text-purple">
                Email it to me
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
