"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishToggle({
  eventId,
  status,
}: {
  eventId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = status === "published";
  const cancelled = status === "cancelled";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: !isLive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't update this event.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (cancelled) {
    return <p className="text-sm text-on-dark-3">This event is cancelled.</p>;
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-lg px-4 py-2.5 font-semibold transition-colors disabled:opacity-60 ${
          isLive
            ? "border border-line-dark text-on-dark hover:border-gold hover:text-gold"
            : "bg-gold text-canvas hover:bg-gold-deep"
        }`}
      >
        {busy ? "Saving…" : isLive ? "Unpublish" : "Publish event"}
      </button>
      {error && <p className="max-w-xs text-sm text-error sm:text-right">{error}</p>}
    </div>
  );
}
