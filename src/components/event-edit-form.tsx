"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CoverImageField } from "@/components/cover-image-field";

export type EditableEvent = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  coverImage: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  country: string | null;
  startDatetime: string;
  endDatetime: string;
  status: string;
  /** The date and venue are stored; these say not to show them. */
  dateTbd: boolean;
  venueTbd: boolean;
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
  const [coverImage, setCoverImage] = useState<string | null>(event.coverImage);
  const [dateTbd, setDateTbd] = useState(event.dateTbd);
  const [venueTbd, setVenueTbd] = useState(event.venueTbd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * How many ticket-holders were emailed about this change.
   *
   * Held rather than redirected past, because an organiser who moves a venue
   * and is bounced straight back to the dashboard has no idea whether anyone
   * was told — and will post it to the group chat anyway, which is the exact
   * work this feature exists to remove.
   */
  const [notified, setNotified] = useState<number | null>(null);
  const [notifyFailures, setNotifyFailures] = useState(0);

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
          coverImage,
          venueName: form.venueName.trim(),
          venueAddress: form.venueAddress.trim(),
          city: form.city.trim(),
          country: form.country.trim(),
          startDatetime: new Date(form.startDatetime).toISOString(),
          endDatetime: new Date(form.endDatetime).toISOString(),
          dateTbd,
          venueTbd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't save those changes.");
        return;
      }
      // Only stop to say so when somebody was actually told. A quiet edit —
      // a typo in the description, a new cover — should still behave exactly
      // as it always did and go straight back.
      if (typeof data.notified === "number" && data.notified > 0) {
        setNotified(data.notified);
        setNotifyFailures(data.notifyFailures ?? 0);
        router.refresh();
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

  if (notified !== null) {
    return (
      <div className="rounded-2xl border border-line-dark bg-surface p-6">
        <h2 className="text-lg font-bold text-on-dark">Saved, and everyone knows</h2>
        <p className="mt-2 text-on-dark-2">
          {notified} {notified === 1 ? "person" : "people"} holding a ticket
          {notified === 1 ? " was" : " were"} emailed about the change.
        </p>
        {notifyFailures > 0 && (
          <p className="mt-2 text-sm text-coral">
            {notifyFailures}{" "}
            {notifyFailures === 1 ? "email" : "emails"} couldn&apos;t be
            delivered. Those addresses may be wrong — worth a message in the
            group chat as a backstop.
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <Link
            href={`/dashboard/events/${event.id}`}
            className="rounded-lg bg-purple px-5 py-2.5 font-semibold text-white transition-colors hover:bg-purple-deep"
          >
            Back to event
          </Link>
          <button
            type="button"
            onClick={() => setNotified(null)}
            className="rounded-lg border border-line-dark px-5 py-2.5 font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
          >
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {event.status === "published" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-on-dark">This event is live</p>
            <p className="text-sm text-on-dark-2">
              Changes show on the public page straight away. If you move the
              date, the time or the venue, everyone holding a ticket is
              emailed automatically — so nobody turns up to the wrong place,
              and you don&apos;t have to chase them yourself.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6">
        <CoverImageField
          value={coverImage}
          onChange={setCoverImage}
          eventId={event.id}
          slugHint={form.title}
        />

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
              disabled={venueTbd}
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-on-dark-2">
              <input
                type="checkbox"
                checked={venueTbd}
                onChange={(e) => setVenueTbd(e.target.checked)}
                className="accent-[#6C3CFF]"
              />
              Venue not confirmed yet
            </label>
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
          A city is required while an event is published, and a venue unless
          you&apos;ve ticked that it isn&apos;t confirmed.
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

        <label className="flex cursor-pointer items-start gap-2 text-sm text-on-dark-2">
          <input
            type="checkbox"
            checked={dateTbd}
            onChange={(e) => setDateTbd(e.target.checked)}
            className="mt-0.5 accent-[#6C3CFF]"
          />
          <span>
            Date not confirmed yet — show &ldquo;to be announced&rdquo;
            instead
          </span>
        </label>

        {(dateTbd || venueTbd) && (
          <p className="rounded-lg border border-purple/30 bg-purple/5 px-3 py-2 text-xs text-on-dark-2">
            Keep your best guess in the fields anyway — nobody sees it, but it
            decides where your event lands in{" "}
            <span className="text-on-dark">What&apos;s on</span>. Moving a
            provisional date emails nobody; confirming it emails everyone
            holding a ticket.
          </p>
        )}
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
