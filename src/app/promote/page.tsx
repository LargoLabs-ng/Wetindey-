"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, Link2, Share2 } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { naira } from "@/lib/fees";

type Promoting = {
  eventId: string;
  title: string;
  status: string;
  startDatetime: string;
  refCode: string | null;
  link: string;
  ticketsSold: number;
  faceValue: number;
};

/**
 * The promoter's whole product: their link, and what it has done.
 *
 * Kept to one page with nothing else on it, because a promoter has exactly
 * one job. They cannot open the dashboard — no event:view — so this is not a
 * cut-down version of it; it is the only thing they have, and it has to
 * answer "what do I paste into WhatsApp" in under a second.
 */
export default function PromotePage() {
  const { status } = useSession();
  const [events, setEvents] = useState<Promoting[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // A failed request used to fall through to the empty list, so "Nothing to
  // promote yet" looked identical whether there was nothing to show or the
  // server had thrown. An empty state that hides an error is a bad empty
  // state — it cost an hour of chasing the wrong thing.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      setEvents([]);
      return;
    }
    fetch("/api/promote")
      .then(async (r) => {
        if (!r.ok) throw new Error(`promote ${r.status}`);
        return r.json();
      })
      .then((d) => setEvents(d.events ?? []))
      .catch(() => {
        setFailed(true);
        setEvents([]);
      });
  }, [status]);

  const copy = async (link: string, id: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked — the link is on screen to select by hand */
    }
  };

  return (
    <div className="wd-night flex min-h-screen flex-col bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink">
          Your links
        </h1>
        <p className="mt-2 text-ink-2">
          Share these. Anything bought through your link is counted as yours.
        </p>

        {events === null ? (
          <p className="mt-8 text-ink-3">Loading…</p>
        ) : status !== "authenticated" ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-6">
            <p className="text-ink-2">
              <Link href="/login" className="font-semibold text-purple hover:underline">
                Sign in
              </Link>{" "}
              to see your links.
            </p>
          </div>
        ) : failed ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-6">
            <p className="font-semibold text-ink">
              Couldn&apos;t load your links.
            </p>
            <p className="mt-1 text-sm text-ink-2">
              Something went wrong on our side, not yours. Try again in a
              moment.
            </p>
          </div>
        ) : events.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-8 text-center">
            <p className="font-extrabold text-ink">Nothing to promote yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-ink-2">
              When an organiser adds you to an event as a promoter, your link
              shows up here.
            </p>
            <Link
              href="/discover"
              className="mt-5 inline-block rounded-xl bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-deep"
            >
              See wetin dey
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {events.map((e) => (
              <div
                key={e.eventId}
                className="rounded-2xl border border-line bg-card p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
                      {e.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-ink-3">
                      {new Date(e.startDatetime).toLocaleDateString("en-NG", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                      })}
                      {e.status !== "published" && " · not live yet"}
                    </p>
                  </div>

                  {/* The number they came for. Tickets, not orders — "I sold
                      12" means twelve people at the door, not twelve
                      transactions. */}
                  <div className="text-right">
                    <p className="text-2xl font-extrabold leading-none text-ink">
                      {e.ticketsSold}
                    </p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {e.ticketsSold === 1 ? "ticket" : "tickets"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-cream px-3 py-2.5 font-mono text-sm text-ink-2">
                    {e.link}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(e.link, e.eventId)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-purple px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-deep"
                  >
                    {copied === e.eventId ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {copied === e.eventId ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `${e.title} — ${e.link}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
                  >
                    <Share2 className="h-4 w-4" />
                    WhatsApp
                  </a>
                </div>

                {e.ticketsSold > 0 && (
                  <p className="mt-3 text-sm text-ink-3">
                    {naira(e.faceValue)} of tickets sold through your link.
                  </p>
                )}
              </div>
            ))}

            {/* Said plainly rather than left to be assumed. Someone selling
                tickets will work out for themselves that a number is being
                counted, and will assume it means money unless told. */}
            <p className="pt-2 text-sm text-ink-3">
              These numbers are a tally, not earnings — Wetin Dey doesn&apos;t
              pay commission. Whatever you&apos;ve agreed with the organiser is
              between you and them.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
