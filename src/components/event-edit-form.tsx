"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

export type EditableEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  country: string | null;
  startDatetime: string;
  endDatetime: string;
  status: string;
};

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const field =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-gold";
const label = "mb-1 block text-sm font-medium text-on-dark-2";

export function EventEditForm({ event }: { event: EditableEvent }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: event.title,
    description: event.description ?? "",
    category: event.category ?? "",
    venueName: event.venueName ?? "",
    venueAddress: event.venueAddress ?? "",
    city: event.city ?? "",
    country: event.country ?? "Nigeria",
    startDatetime: toLocalInput(event.startDatetime),
    endDatetime: toLocalInput(event.endDatetime),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category.trim(),
          venueName: form.venueName.trim(),
          venueAddress: form.venueAddress.trim(),
          city: form.city.trim(),
          country: form.country.trim(),
          startDatetime: new Date(form.startDatetime).toISOString(),
          endDatetime: new Date(form.endDatetime).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save those changes.");
        return;
      }
      router.push(`/dashboard/events/${event.id}`);
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {event.status === "published" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-on-dark">This event is live</p>
            <p className="text-sm text-on-dark-2">
              Changes show on the public page straight away. Anyone who already
              bought a ticket won&apos;t be told automatically — if you move the
              date or venue, message them yourself.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6">
        <div>
          <label className={label}>Event title</label>
          <input
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className={field}
          />
        </div>

        <div>
          <label className={label}>Description</label>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What should people know before they buy?"
            className={field}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Category</label>
            <input
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Conference"
              className={field}
            />
          </div>
          <div>
            <label className={label}>Country</label>
            <input
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              className={field}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6">
        <h2 className="font-bold text-on-dark">Where</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Venue</label>
            <input
              value={form.venueName}
              onChange={(e) => set("venueName", e.target.value)}
              placeholder="e.g. Uniuyo Auditorium"
              className={field}
            />
          </div>
          <div>
            <label className={label}>City</label>
            <input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="e.g. Uyo"
              className={field}
            />
          </div>
        </div>
        <div>
          <label className={label}>Address</label>
          <input
            value={form.venueAddress}
            onChange={(e) => set("venueAddress", e.target.value)}
            placeholder="Street address, landmark"
            className={field}
          />
        </div>
        <p className="text-xs text-on-dark-3">
          A venue and city are required while an event is published.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6">
        <h2 className="font-bold text-on-dark">When</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Starts</label>
            <input
              required
              type="datetime-local"
              value={form.startDatetime}
              onChange={(e) => set("startDatetime", e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className={label}>Ends</label>
            <input
              required
              type="datetime-local"
              value={form.endDatetime}
              onChange={(e) => set("endDatetime", e.target.value)}
              className={field}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-gold px-5 py-2.5 font-semibold text-canvas transition-colors hover:bg-gold-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/events/${event.id}`)}
          className="rounded-lg px-3 py-2 text-sm font-medium text-on-dark-2 transition-colors hover:text-on-dark"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
