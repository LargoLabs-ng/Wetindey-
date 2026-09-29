"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  FIELD_KINDS,
  MAX_FIELDS,
  hasOptions,
  type FieldKind,
} from "@/lib/registration";

/**
 * The questions an organiser adds to their own checkout form.
 *
 * Reordering is two arrow buttons rather than drag-and-drop. Drag is nicer
 * with a mouse and close to unusable with a thumb on a 5" screen, which is
 * where most of this will actually be done.
 */

type Row = {
  id?: string;
  key: string;
  label: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
};

const input =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-purple";
const caption = "mb-1 block text-xs font-medium text-on-dark-2";

let seq = 0;
const nextKey = () => `new-${++seq}`;

function blank(): Row {
  return {
    key: nextKey(),
    label: "",
    kind: "short_text",
    options: [],
    required: false,
  };
}

export function RegistrationFieldsEditor({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/registration-fields`);
        if (!res.ok) throw new Error("Could not load your questions.");
        const data = await res.json();
        if (cancelled) return;
        setRows(
          (data.fields ?? []).map(
            (f: {
              id: string;
              label: string;
              kind: FieldKind;
              options: string[] | null;
              required: boolean;
            }) => ({
              id: f.id,
              key: f.id,
              label: f.label,
              kind: f.kind,
              options: f.options ?? [],
              required: f.required,
            })
          )
        );
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

  const patch = useCallback((key: string, next: Partial<Row>) => {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }, []);

  const move = useCallback((index: number, by: -1 | 1) => {
    setSaved(false);
    setRows((rs) => {
      const to = index + by;
      if (to < 0 || to >= rs.length) return rs;
      const copy = [...rs];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/registration-fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: rows.map((r) => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          options: r.options,
          required: r.required,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Could not save your questions.");
      return;
    }
    // Rebuild from the server's answer so newly-created rows pick up their
    // real ids — otherwise the next save inserts them a second time.
    setRows(
      (data.fields ?? []).map(
        (f: {
          id: string;
          label: string;
          kind: FieldKind;
          options: string[] | null;
          required: boolean;
        }) => ({
          id: f.id,
          key: f.id,
          label: f.label,
          kind: f.kind,
          options: f.options ?? [],
          required: f.required,
        })
      )
    );
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-on-dark-2">
        <Loader2 className="h-4 w-4 animate-spin text-purple" />
        Loading your questions…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-on-dark">What else do you need to know?</h3>
        <p className="mt-1 text-sm text-on-dark-2">
          Extra questions on the checkout form, on top of name and email.
          Matric number, department, level, shirt size — whatever you&apos;d
          otherwise have to chase people for afterwards.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-dark px-4 py-6 text-center text-sm text-on-dark-3">
          No extra questions. People just give their name and email.
        </p>
      )}

      {rows.map((row, i) => (
        <div
          key={row.key}
          className="rounded-xl border border-line-dark bg-canvas/40 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={caption}>Question</label>
              <input
                value={row.label}
                onChange={(e) => patch(row.key, { label: e.target.value })}
                placeholder="e.g. Matric number"
                className={input}
              />
            </div>
            <div>
              <label className={caption}>Answer type</label>
              <select
                value={row.kind}
                onChange={(e) => {
                  const kind = e.target.value as FieldKind;
                  patch(row.key, {
                    kind,
                    // Moving to a kind with choices seeds two empty ones so
                    // the organiser can see what's expected of them.
                    options:
                      hasOptions(kind) && row.options.length < 2
                        ? ["", ""]
                        : row.options,
                  });
                }}
                className={`${input} sm:w-44`}
              >
                {FIELD_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasOptions(row.kind) && (
            <div className="mt-3">
              <label className={caption}>Options</label>
              <div className="space-y-2">
                {row.options.map((opt, oi) => (
                  <div key={oi} className="flex gap-2">
                    <input
                      value={opt}
                      onChange={(e) => {
                        const options = [...row.options];
                        options[oi] = e.target.value;
                        patch(row.key, { options });
                      }}
                      placeholder={`Option ${oi + 1}`}
                      className={input}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patch(row.key, {
                          options: row.options.filter((_, x) => x !== oi),
                        })
                      }
                      className="rounded-lg border border-line-dark px-3 text-on-dark-3 transition-colors hover:text-coral"
                      aria-label={`Remove option ${oi + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => patch(row.key, { options: [...row.options, ""] })}
                className="mt-2 text-sm font-medium text-purple-lift hover:underline"
              >
                + Add option
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-dark-2">
              <input
                type="checkbox"
                checked={row.required}
                onChange={(e) => patch(row.key, { required: e.target.checked })}
                className="accent-[#6C3CFF]"
              />
              They can&apos;t check out without answering
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="rounded-lg border border-line-dark p-2 text-on-dark-3 transition-colors hover:text-on-dark disabled:opacity-30"
                aria-label="Move question up"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                className="rounded-lg border border-line-dark p-2 text-on-dark-3 transition-colors hover:text-on-dark disabled:opacity-30"
                aria-label="Move question down"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaved(false);
                  setRows((rs) => rs.filter((r) => r.key !== row.key));
                }}
                className="rounded-lg border border-line-dark p-2 text-on-dark-3 transition-colors hover:text-coral"
                aria-label="Remove question"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={rows.length >= MAX_FIELDS}
          onClick={() => {
            setSaved(false);
            setRows((rs) => [...rs, blank()]);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Add a question
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-purple px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save questions"}
        </button>

        {saved && <span className="text-sm text-purple-lift">Saved.</span>}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-on-dark-3">
          Answers show up beside each buyer on your guest list and in the CSV
          export. Deleting a question later keeps the answers people already
          gave — it just stops asking new buyers.
        </p>
      )}
    </div>
  );
}
