"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { Banner, border, card, naira, shortDate, StatusBadge } from "@/components/payout-ui";

type Row = {
  id: string;
  status: string;
  amount: number;
  requestedAt: string;
  organization: { id: string; name: string };
  owner: { name: string | null; email: string } | null;
  balance: { available: number; settledNet: number; unsettledNet: number; shortfall: number };
  needsReview: boolean;
};

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "processing", label: "Being sent" },
  { key: "failed", label: "Failed" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const EMPTY: Record<FilterKey, string> = {
  pending: "No payout requests waiting for review.",
  approved: "Nothing approved and waiting to be sent.",
  processing: "No transfers in progress.",
  failed: "No failed transfers.",
  paid: "No payouts marked paid yet.",
  rejected: "No rejected requests.",
  all: "No payout requests yet.",
};

/**
 * Admin → Payouts. The queue of organiser withdrawal requests.
 *
 * Opens on Pending, oldest first. Each card links to the full request, where
 * the bank details and the actions are.
 */
export default function AdminPayoutsPage() {
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/payouts?status=${filter}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Couldn't load payout requests.");
        if (!cancelled) {
          setRows(data.requests ?? []);
          setCounts(data.counts ?? {});
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't load payout requests.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  function choose(key: FilterKey) {
    if (key === filter) return;
    setRows(null);
    setFilter(key);
  }

  async function syncSettlements() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      let response = await fetch("/api/admin/payouts/sync-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "write" }),
      });
      let data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        // Writes are switched off: show what a sync would do instead.
        response = await fetch("/api/admin/payouts/sync-settlements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "dry-run" }),
        });
        data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Couldn't reach Paystack.");
        setSyncMessage({
          tone: "warn",
          text: `Settlement updates are switched off. A dry run found ${data.summary?.toMark ?? 0} payment(s) Paystack has settled that would be recorded.`,
        });
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Couldn't reach Paystack.");
      const s = data.summary ?? {};
      const problems =
        (s.amountMismatch ?? 0) + (s.notSuccessLocally ?? 0) + (s.conflicts ?? 0) + (s.duplicateInProvider ?? 0) + (s.wrongProvider ?? 0);
      setSyncMessage({
        tone: problems > 0 ? "warn" : "ok",
        text:
          `Paystack checked. ${s.written ?? 0} newly settled payment(s) recorded; ${s.stillUnsettled?.count ?? 0} still waiting.` +
          (problems > 0 ? ` ${problems} item(s) didn't match and were left alone — check the server log.` : ""),
      });
      setReloadKey((k) => k + 1);
    } catch (reason) {
      setSyncMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Couldn't reach Paystack." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-forest)" }}>
            Payouts
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-stone)" }}>
            Organiser withdrawal requests. Only money Paystack has settled to Wetin Dey can be paid out.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void syncSettlements()}
          disabled={syncing}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ ...border, color: "var(--color-purple)" }}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Checking Paystack…" : "Refresh from Paystack"}
        </button>
      </div>

      {syncMessage && (
        <div className="mt-4">
          <Banner tone={syncMessage.tone}>{syncMessage.text}</Banner>
        </div>
      )}

      {/* Filter chips: one row that scrolls sideways on a phone. */}
      <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map(({ key, label }) => {
          const active = key === filter;
          const n = key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[key] ?? 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              aria-pressed={active}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold"
              style={{
                borderColor: active ? "var(--color-purple)" : "var(--color-line)",
                backgroundColor: active ? "var(--color-purple)" : "white",
                color: active ? "white" : "var(--color-stone)",
              }}
            >
              {label}
              <span className="text-xs opacity-80">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {error ? (
          <div className="space-y-3">
            <Banner tone="error">{error}</Banner>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: "var(--color-purple)" }}
            >
              Try again
            </button>
          </div>
        ) : rows === null ? (
          <ul className="space-y-3" aria-label="Loading payout requests">
            {[0, 1, 2].map((i) => (
              <li key={i} className={`${card} animate-pulse`} style={border}>
                <div className="h-4 w-1/2 rounded" style={{ backgroundColor: "var(--color-ivory-2)" }} />
                <div className="mt-3 h-6 w-1/3 rounded" style={{ backgroundColor: "var(--color-ivory-2)" }} />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className={card} style={{ ...border, color: "var(--color-stone)" }}>
            {EMPTY[filter]}
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/payouts/${r.id}`} className={`${card} block transition-shadow hover:shadow-md`} style={border}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold" style={{ color: "var(--color-forest)" }}>
                        {r.organization.name}
                      </p>
                      <p className="truncate text-xs" style={{ color: "var(--color-stone-mid)" }}>
                        {r.owner?.name ?? r.owner?.email ?? "Owner unknown"} · requested {shortDate(r.requestedAt)}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-2xl font-extrabold tracking-tight" style={{ color: "var(--color-forest)" }}>
                        {naira(r.amount)}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-stone)" }}>
                        Settled {naira(r.balance.settledNet)} · waiting {naira(r.balance.unsettledNet)}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0" style={{ color: "var(--color-stone-mid)" }} />
                  </div>
                  {r.needsReview && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-danger)" }}>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Needs review: open requests exceed settled money by {naira(r.balance.shortfall)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
