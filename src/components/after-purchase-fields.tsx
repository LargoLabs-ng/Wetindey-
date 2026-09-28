"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * What buyers are told once they've paid.
 *
 * Self-contained and self-saving, like the registration fields editor, so it
 * can sit in the creation wizard and on the edit page without either of them
 * having to know what's inside it.
 */

const field =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-purple";
const label = "mb-1 block text-sm font-medium text-on-dark-2";

export function AfterPurchaseFields({ eventId }: { eventId: string }) {
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error("Could not load this event.");
        const data = await res.json();
        const ev = data.event ?? data;
        if (cancelled) return;
        setNote(ev.afterPurchaseNote ?? "");
        setUrl(ev.afterPurchaseUrl ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Empty strings are sent deliberately: the API turns a blank into null,
      // which is how somebody clears a link they no longer want on tickets.
      body: JSON.stringify({ afterPurchaseNote: note, afterPurchaseUrl: url }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(
        data.error === "Invalid input"
          ? "That link doesn't look right — it needs to start with https://"
          : (data.error ?? "Could not save.")
      );
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-on-dark-2">
        <Loader2 className="h-4 w-4 animate-spin text-purple" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-on-dark">
          What do they get after they pay?
        </h3>
        <p className="mt-1 text-sm text-on-dark-2">
          Shown on their ticket page and in their confirmation email — never on
          the public event page. The WhatsApp group, the Zoom link, which gate
          to come through. This is the message you&apos;d otherwise be sending
          one by one at 2am.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      <div>
        <label className={label}>Message</label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. Join the group below for updates. Doors open 7pm sharp — come through the side gate, not the main one."
          className={field}
        />
      </div>

      <div>
        <label className={label}>Link (optional)</label>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setSaved(false);
          }}
          placeholder="https://chat.whatsapp.com/…"
          className={field}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-purple px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-purple-lift">Saved.</span>}
      </div>

      <p className="text-xs text-on-dark-3">
        Keep group invites here rather than in the event description — a
        WhatsApp link on a public page is a group full of people who never
        bought a ticket.
      </p>
    </div>
  );
}
