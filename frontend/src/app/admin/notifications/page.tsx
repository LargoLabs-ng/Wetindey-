"use client";

import { useCallback, useEffect, useState } from "react";

type Health = {
  switches: { notifications: boolean; email: boolean };
  email: { sentToday: number; dailyBudget: number };
  health: { failedLast24h: number; oldestWaitingMinutes: number; pending: number; unhealthy: boolean };
  last24h: { inApp: number; emailsSent: number; skipped: number };
  eventsPending: number;
  failedDeliveries: Array<{
    id: string;
    channel: string;
    category: string;
    email: string | null;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    eventType: string | null;
  }>;
  failedEvents: Array<{ id: string; type: string; attempts: number; lastError: string | null; createdAt: string }>;
};

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--color-line)" }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-stone)" }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold" style={{ color: warn ? "var(--color-bad)" : "var(--color-forest)" }}>
        {value}
      </p>
    </div>
  );
}

export default function AdminNotificationsPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchHealth = useCallback(async (): Promise<Health> => {
    const res = await fetch("/api/admin/notifications", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not load notification health.");
    return body;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchHealth());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notification health.");
    }
  }, [fetchHealth]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await fetchHealth();
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load notification health.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchHealth]);

  async function runNow(task: "worker" | "daily") {
    setBusy(task);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/notifications/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The run failed.");
      if (body.skipped) {
        setNotice(body.skipped);
      } else {
        const w = body.worker;
        setNotice(
          `Done. Events handled: ${w.events.done}. Sent: ${w.deliveries.sent}. Will retry: ${w.deliveries.retried + w.events.retried}. Failed: ${w.deliveries.failed + w.events.failed}.` +
            (task === "daily" && body.sweep ? ` Missed items found by the daily check: ${(body.sweep.ordersRecovered ?? 0) + (body.sweep.payoutRequestsRecovered ?? 0) + (body.sweep.payoutUpdatesRecovered ?? 0)}.` : "")
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The run failed.");
    } finally {
      setBusy(null);
    }
  }

  async function retry(kind: "delivery" | "event", id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/notifications/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Retry failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold" style={{ color: "var(--color-forest)" }}>
        Notification delivery health
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--color-stone)" }}>
        What&apos;s waiting, what failed, and today&apos;s email use. Failed items can be retried: each retry gets a fresh 5 attempts.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => runNow("worker")}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: "var(--color-purple)" }}
        >
          {busy === "worker" ? "Processing…" : "Process now"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => runNow("daily")}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ borderColor: "var(--color-line)" }}
        >
          {busy === "daily" ? "Checking…" : "Run daily check"}
        </button>
      </div>
      {notice && <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="mt-6">Loading…</p>}

      {data && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full border bg-white px-3 py-1" style={{ borderColor: "var(--color-line)" }}>
              Notifications: <strong>{data.switches.notifications ? "on" : "off"}</strong>
            </span>
            <span className="rounded-full border bg-white px-3 py-1" style={{ borderColor: "var(--color-line)" }}>
              Email sending: <strong>{data.switches.email ? "on" : "off"}</strong>
            </span>
            {data.health.unhealthy && (
              <span className="rounded-full px-3 py-1 font-semibold text-white" style={{ backgroundColor: "var(--color-bad)" }}>
                Needs attention
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Failed (24 h)" value={data.health.failedLast24h} warn={data.health.failedLast24h > 0} />
            <Stat label="Waiting to send" value={data.health.pending} />
            <Stat
              label="Oldest waiting"
              value={data.health.oldestWaitingMinutes > 0 ? `${data.health.oldestWaitingMinutes} min` : "—"}
              warn={data.health.oldestWaitingMinutes > 60}
            />
            <Stat label="Emails today" value={`${data.email.sentToday} / ${data.email.dailyBudget}`} />
            <Stat label="In-app (24 h)" value={data.last24h.inApp} />
            <Stat label="Emails sent (24 h)" value={data.last24h.emailsSent} />
            <Stat label="Skipped (24 h)" value={data.last24h.skipped} />
            <Stat label="Events queued" value={data.eventsPending} />
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--color-stone)" }}>
            &ldquo;Emails today&rdquo; counts notification emails since midnight Lagos time. Summaries and digests stop at the daily limit; tickets, money and security emails never do.
          </p>

          <h2 className="mt-8 text-lg font-bold">Failed deliveries</h2>
          {data.failedDeliveries.length === 0 ? (
            <p className="mt-2 rounded-xl border bg-white p-4 text-sm" style={{ borderColor: "var(--color-line)" }}>
              None. 🎉
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.failedDeliveries.map((d) => (
                <li key={d.id} className="rounded-xl border bg-white p-4 text-sm" style={{ borderColor: "var(--color-line)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {d.eventType ?? "—"} · {d.channel} · {d.category}
                      </p>
                      <p style={{ color: "var(--color-stone)" }}>
                        {d.email ?? "—"} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"} · {new Date(d.createdAt).toLocaleString("en-NG")}
                      </p>
                      {d.lastError && <p className="mt-1 break-words text-red-700">{d.lastError}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={busy === d.id}
                      onClick={() => retry("delivery", d.id)}
                      className="rounded-lg px-3 py-2 font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: "var(--color-purple)" }}
                    >
                      {busy === d.id ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-lg font-bold">Failed events</h2>
          {data.failedEvents.length === 0 ? (
            <p className="mt-2 rounded-xl border bg-white p-4 text-sm" style={{ borderColor: "var(--color-line)" }}>
              None.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.failedEvents.map((e) => (
                <li key={e.id} className="rounded-xl border bg-white p-4 text-sm" style={{ borderColor: "var(--color-line)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{e.type}</p>
                      <p style={{ color: "var(--color-stone)" }}>
                        {e.attempts} attempt{e.attempts === 1 ? "" : "s"} · {new Date(e.createdAt).toLocaleString("en-NG")}
                      </p>
                      {e.lastError && <p className="mt-1 break-words text-red-700">{e.lastError}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={busy === e.id}
                      onClick={() => retry("event", e.id)}
                      className="rounded-lg px-3 py-2 font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: "var(--color-purple)" }}
                    >
                      {busy === e.id ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
