"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

type Switch = { channel: "in_app" | "email"; label: string; on: boolean; locked: boolean; lockedReason: string | null };
type Topic = { category: string; title: string; description: string; switches: Switch[] };
type Section = { id: string; title: string; topics: Topic[] };

function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      // 44px tall tap area around a 28px switch.
      className="group -my-2 inline-flex h-11 shrink-0 items-center disabled:cursor-not-allowed"
    >
      <span
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
          on ? "bg-purple" : "bg-line"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

export function NotificationSettings() {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/notifications/preferences", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load your settings.");
        if (!cancelled) setSections(data.sections ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load your settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setLocal(category: string, channel: string, on: boolean) {
    setSections((current) =>
      (current ?? []).map((s) => ({
        ...s,
        topics: s.topics.map((t) =>
          t.category !== category
            ? t
            : { ...t, switches: t.switches.map((sw) => (sw.channel === channel ? { ...sw, on } : sw)) }
        ),
      }))
    );
  }

  async function change(category: string, channel: string, enabled: boolean) {
    const key = `${category}:${channel}`;
    setError(null);
    setSaving(key);
    setLocal(category, channel, enabled); // Show it straight away…
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, channel, enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that. Try again.");
    } catch (e) {
      setLocal(category, channel, !enabled); // …and put it back if saving failed.
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (error && !sections) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!sections) return <p className="text-ink-3">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.id}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-3">{section.title}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {section.topics.map((topic) => (
              <li key={topic.category} className="p-4">
                <p className="font-semibold text-ink">{topic.title}</p>
                <p className="mt-0.5 text-sm text-ink-2">{topic.description}</p>
                <div className="mt-3 space-y-2">
                  {topic.switches.map((sw) => (
                    <div key={sw.channel} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{sw.label}</p>
                        {sw.locked && (
                          <p className="flex items-center gap-1 text-xs text-ink-3">
                            <Lock className="h-3 w-3 shrink-0" aria-hidden />
                            {sw.lockedReason}
                          </p>
                        )}
                      </div>
                      <Toggle
                        on={sw.on}
                        disabled={sw.locked || saving === `${topic.category}:${sw.channel}`}
                        label={`${topic.title}: ${sw.label}`}
                        onChange={(next) => change(topic.category, sw.channel, next)}
                      />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-3">Your tickets</h2>
        <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink-2">
          Ticket and order emails always reach you. Choices for reminders and new events near you are coming soon.
        </div>
      </section>
    </div>
  );
}
