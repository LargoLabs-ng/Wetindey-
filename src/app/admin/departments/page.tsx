"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, GitMerge, X } from "lucide-react";

type Dept = {
  id: string;
  name: string;
  status: string;
  universityId: string;
  university: string;
  facultyId: string | null;
  students: number;
  createdAt: string;
};
type Faculty = { id: string; name: string; universityId: string };

export default function DepartmentReviewPage() {
  const [pending, setPending] = useState<Dept[]>([]);
  const [unplaced, setUnplaced] = useState<Dept[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [all, setAll] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/departments");
    if (!res.ok) {
      setError("Could not load the queue.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPending(data.pending);
    setUnplaced(data.unplaced);
    setFaculties(data.faculties);
    setAll([...data.pending, ...data.unplaced]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(id);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/admin/departments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "That didn't work.");
      return;
    }
    if (data.studentsMoved !== undefined) {
      setNotice(
        `Merged into ${data.mergedInto} — ${data.studentsMoved} ${
          data.studentsMoved === 1 ? "student" : "students"
        } moved across.`
      );
    }
    await load();
  }

  const card = "rounded-lg border bg-white p-4";
  const border = { borderColor: "var(--color-stone-mid)" };

  if (loading) {
    return (
      <p className="p-8" style={{ color: "var(--color-stone)" }}>
        Loading review queue…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold" style={{ color: "var(--color-forest)" }}>
        Departments
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--color-stone)" }}>
        The seeded list came from public directories that disagreed with each
        other, so students can add what&apos;s missing. Their suggestions wait
        here — nobody else sees a department until it&apos;s approved.
      </p>

      {error && (
        <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: "var(--color-ok-soft, #E3F3EC)", color: "var(--color-success)" }}>
          {notice}
        </p>
      )}

      {/* ── Suggested by students ─────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--color-stone-mid)" }}>
          Waiting for review ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--color-stone)" }}>
            Nothing waiting. Suggestions appear here as students sign up.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((d) => (
              <li key={d.id} className={card} style={border}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold" style={{ color: "var(--color-forest)" }}>
                      {d.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-stone-mid)" }}>
                      {d.university} · {d.students}{" "}
                      {d.students === 1 ? "student" : "students"} chose this
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy === d.id}
                      onClick={() => act(d.id, "approve")}
                      className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--color-success)" }}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      disabled={busy === d.id}
                      onClick={() => act(d.id, "reject")}
                      className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                      style={{ ...border, color: "var(--color-stone)" }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <GitMerge className="h-3.5 w-3.5" style={{ color: "var(--color-stone-mid)" }} />
                  <label className="text-xs" style={{ color: "var(--color-stone)" }}>
                    Same thing as an existing one?
                  </label>
                  <select
                    defaultValue=""
                    disabled={busy === d.id}
                    onChange={(e) => {
                      if (e.target.value) act(d.id, "merge", { intoId: e.target.value });
                    }}
                    className="rounded border px-2 py-1 text-sm"
                    style={border}
                  >
                    <option value="">Merge into…</option>
                    {all
                      .filter((o) => o.id !== d.id && o.universityId === d.universityId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Seeded but unattributed ───────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--color-stone-mid)" }}>
          No faculty yet ({unplaced.length})
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-stone)" }}>
          Real programmes, but no published source said which faculty runs
          them. They&apos;re offered to students already — this just files them
          properly.
        </p>

        <ul className="mt-3 space-y-2">
          {unplaced.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3"
              style={border}
            >
              <span style={{ color: "var(--color-forest)" }}>{d.name}</span>
              <select
                defaultValue=""
                disabled={busy === d.id}
                onChange={(e) =>
                  e.target.value && act(d.id, "assign-faculty", { facultyId: e.target.value })
                }
                className="rounded border px-2 py-1 text-sm"
                style={border}
              >
                <option value="">Assign faculty…</option>
                {faculties
                  .filter((f) => f.universityId === d.universityId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
