"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type FormState = {
  title: string;
  description: string;
  category: string;
  venueName: string;
  city: string;
  startDatetime: string;
  endDatetime: string;
};

const initialState: FormState = {
  title: "",
  description: "",
  category: "",
  venueName: "",
  city: "",
  startDatetime: "",
  endDatetime: "",
};

export default function NewEventPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        startDatetime: new Date(form.startDatetime).toISOString(),
        endDatetime: new Date(form.endDatetime).toISOString(),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    router.push(`/dashboard/events/${data.event.id}`);
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/events"
        className="text-sm text-on-dark-2 hover:text-on-dark transition-colors"
      >
        ← Back to events
      </Link>

      <h1 className="text-2xl font-bold text-on-dark mt-2 mb-6">
        Create event
      </h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-surface border border-line-dark rounded-2xl p-6"
      >
        {error && <p className="text-error text-sm">{error}</p>}

        <div>
          <label className="block text-sm font-medium text-on-dark mb-1">
            Event title
          </label>
          <input
            required
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. TEDx UNIUYO 2026"
            className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-on-dark mb-1">
            Description
          </label>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-on-dark mb-1">
              Category
            </label>
            <input
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              placeholder="e.g. Conference"
              className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-on-dark mb-1">
              City
            </label>
            <input
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              placeholder="e.g. Uyo"
              className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-on-dark mb-1">
            Venue
          </label>
          <input
            value={form.venueName}
            onChange={(e) => update("venueName", e.target.value)}
            placeholder="e.g. Uniuyo Auditorium"
            className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-on-dark mb-1">
              Starts
            </label>
            <input
              type="datetime-local"
              required
              value={form.startDatetime}
              onChange={(e) => update("startDatetime", e.target.value)}
              className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-on-dark mb-1">
              Ends
            </label>
            <input
              type="datetime-local"
              required
              value={form.endDatetime}
              onChange={(e) => update("endDatetime", e.target.value)}
              className="w-full rounded-lg border border-line-dark bg-canvas text-on-dark px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>
        </div>

        <p className="text-xs text-on-dark-2">
          Venue and city can be added later, but both are required before you
          can publish.
        </p>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-gold text-canvas font-semibold py-2.5 hover:bg-gold-deep transition-colors disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create event"}
        </button>
      </form>
    </div>
  );
}
