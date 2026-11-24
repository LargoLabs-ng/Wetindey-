"use client";

import Link from "next/link";
import { useState } from "react";

type State = "ask" | "done" | "undone";

export function UnsubscribeConfirm({ token, name }: { token: string; name: string }) {
  const [state, setState] = useState<State>("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(resubscribe: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/unsubscribe?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resubscribe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work. Try again.");
      setState(resubscribe ? "undone" : "done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const button =
    "w-full rounded-xl px-5 py-3 font-bold disabled:opacity-60 sm:w-auto";

  return (
    <div className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      {state === "ask" && (
        <>
          <h1 className="text-xl font-bold text-ink">Stop {name}?</h1>
          <p className="mt-2 text-sm text-ink-2">
            You&apos;ll still see these in the app, and emails about your tickets and money always reach you.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(false)}
            className={`${button} mt-5 bg-purple text-white`}
          >
            {busy ? "Unsubscribing…" : "Unsubscribe"}
          </button>
        </>
      )}
      {state === "done" && (
        <>
          <h1 className="text-xl font-bold text-ink">Done. No more {name}.</h1>
          <p className="mt-2 text-sm text-ink-2">Changed your mind? You can undo it now, or any time in your settings.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(true)}
            className={`${button} mt-5 border border-line bg-cream text-ink`}
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        </>
      )}
      {state === "undone" && (
        <>
          <h1 className="text-xl font-bold text-ink">You&apos;re back on {name}.</h1>
          <p className="mt-2 text-sm text-ink-2">Nothing else changed.</p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href="/profile/notifications" className="font-semibold text-purple">
          All notification settings
        </Link>
      </p>
    </div>
  );
}
