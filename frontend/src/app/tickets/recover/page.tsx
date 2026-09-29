"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Lost your ticket email.
 *
 * No account needed, because most buyers are guests — requiring one here
 * would mean telling a student who has already paid that they have to
 * register before they can get in. The email itself is the proof.
 */
export default function RecoverTicketsPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/tickets/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setSent(data.message ?? "If we have tickets for that address, they're on their way.");
  }

  return (
    // A short page has to be told where to sit. Flowing from the top of a
    // laptop viewport, a 450px column of form strands itself above 500px of
    // empty background and reads as a page that failed to load rather than a
    // page with little on it. Column layout, header pinned, main taking the
    // remaining height and centring its card inside it.
    <div className="wd-night flex min-h-screen flex-col bg-cream">
      <header className="border-b border-line">
        {/* max-w-5xl to match the header on every other consumer page. This
            was max-w-3xl, so the wordmark sat a different distance from the
            edge here than on home or discover — small, but enough to make
            the page look like it belongs to another site. */}
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
            <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
              Can&apos;t find your ticket?
            </h1>
            <p className="mt-2 text-ink-2">
              Put in the email you used and we&apos;ll send it again — QR code
              and all. No account needed.
            </p>

            {sent ? (
              <div className="mt-6 text-center">
                <Mail className="mx-auto h-8 w-8 text-purple" />
                <p className="mt-3 font-semibold text-ink">{sent}</p>
                <p className="mt-2 text-sm text-ink-2">
                  Still nothing after a few minutes? The address might be
                  different from the one you paid with — try another.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSent(null);
                    setEmail("");
                  }}
                  className="mt-4 text-sm font-semibold text-purple"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="The email you paid with"
                  aria-label="Email address"
                  // bg-cream, not bg-card: inside a card the field has to be
                  // a different surface from the thing holding it, or it
                  // reads as a line of text with a box drawn round it.
                  className="w-full rounded-xl border border-line bg-cream px-4 py-3 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-purple py-3 font-semibold text-white hover:bg-purple-deep disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Send my tickets"}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-ink-3">
            Have an account?{" "}
            <Link href="/my-events" className="font-semibold text-purple">
              See your tickets
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
