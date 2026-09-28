"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { naira } from "@/lib/fees";
import type { PromoKind } from "@/lib/promo";

/**
 * Discount codes and refer-to-earn codes.
 *
 * One editor for both, because they are one box at checkout. The form
 * changes shape by kind — a discount needs a label, a referral needs a name —
 * and the performance figures underneath change meaning with it: a discount
 * shows what it gave away, a referral shows what is owed.
 */

type Row = {
  id?: string;
  key: string;
  kind: PromoKind;
  code: string;
  label: string;
  promoterName: string;
  rate: string;
  usageLimit: string;
  active: boolean;
  // Read-only, from the server.
  orders?: number;
  tickets?: number;
  revenue?: number;
  discountGiven?: number;
  commissionOwed?: number;
  usedCount?: number;
};

const input =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-purple";
const caption = "mb-1 block text-xs font-medium text-on-dark-2";

let seq = 0;

function blank(kind: PromoKind): Row {
  return {
    key: `new-${++seq}`,
    kind,
    code: "",
    label: "",
    promoterName: "",
    rate: kind === "discount" ? "10" : "5",
    usageLimit: "",
    active: true,
  };
}

type ServerCode = {
  id: string;
  kind: PromoKind;
  code: string;
  label: string | null;
  promoterName: string | null;
  rate: number;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  orders: number;
  tickets: number;
  revenue: number;
  discountGiven: number;
  commissionOwed: number;
};

function toRow(c: ServerCode): Row {
  return {
    id: c.id,
    key: c.id,
    kind: c.kind,
    code: c.code,
    label: c.label ?? "",
    promoterName: c.promoterName ?? "",
    rate: String(c.rate),
    usageLimit: c.usageLimit === null ? "" : String(c.usageLimit),
    active: c.active,
    orders: c.orders,
    tickets: c.tickets,
    revenue: c.revenue,
    discountGiven: c.discountGiven,
    commissionOwed: c.commissionOwed,
    usedCount: c.usedCount,
  };
}

export function PromoCodesEditor({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether this person may see the money at all.
   *
   * The GET is gated on `finance:view` and the PUT on `event:edit`, so an
   * Editor without the money switch can create codes but not read what they
   * earned. Rather than show them an error, the component just loads empty
   * and says so.
   */
  const [canSeeMoney, setCanSeeMoney] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/promo-codes`);
        if (res.status === 403) {
          if (!cancelled) setCanSeeMoney(false);
          return;
        }
        if (!res.ok) throw new Error("Could not load your codes.");
        const data = await res.json();
        if (!cancelled) setRows((data.codes ?? []).map(toRow));
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

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/promo-codes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codes: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          code: r.code.trim(),
          label: r.label.trim() || null,
          promoterName: r.promoterName.trim() || null,
          rate: Number(r.rate) || 0,
          usageLimit: r.usageLimit.trim() ? Number(r.usageLimit) : null,
          active: r.active,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save those codes.");
      return;
    }
    // Rebuilt from the server so new rows pick up their ids — otherwise the
    // next save inserts them a second time.
    setRows((data.codes ?? []).map(toRow));
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-on-dark-2">
        <Loader2 className="h-4 w-4 animate-spin text-purple" />
        Loading your codes…
      </div>
    );
  }

  if (!canSeeMoney) {
    return (
      <div>
        <h3 className="font-bold text-on-dark">Discount and referral codes</h3>
        <p className="mt-1 text-sm text-on-dark-2">
          You don&apos;t have access to this event&apos;s money, so codes and
          what they&apos;ve earned are hidden. The owner can switch that on
          from the team page.
        </p>
      </div>
    );
  }

  const owed = rows.reduce((n, r) => n + (r.commissionOwed ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-on-dark">Discount and referral codes</h3>
        <p className="mt-1 text-sm text-on-dark-2">
          A <span className="text-on-dark">discount</span> code takes money off
          the buyer&apos;s ticket. A{" "}
          <span className="text-on-dark">refer-to-earn</span> code changes
          nothing for the buyer and records what somebody is owed for bringing
          them. One code per order.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-dark px-4 py-6 text-center text-sm text-on-dark-3">
          No codes yet.
        </p>
      )}

      {rows.map((row) => {
        const isRef = row.kind === "refer_to_earn";
        const used = row.usedCount ?? 0;
        return (
          <div
            key={row.key}
            className="rounded-xl border border-line-dark bg-canvas/40 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className={caption}>Code</label>
                <input
                  value={row.code}
                  onChange={(e) =>
                    patch(row.key, { code: e.target.value.toUpperCase() })
                  }
                  placeholder={isRef ? "AMAKA7" : "FRESHERS20"}
                  className={`${input} font-mono`}
                />
              </div>
              <div>
                <label className={caption}>
                  {isRef ? "Who gets the commission" : "What you call it"}
                </label>
                <input
                  value={isRef ? row.promoterName : row.label}
                  onChange={(e) =>
                    patch(
                      row.key,
                      isRef
                        ? { promoterName: e.target.value }
                        : { label: e.target.value }
                    )
                  }
                  placeholder={isRef ? "e.g. Amaka" : "e.g. Freshers promo"}
                  className={input}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSaved(false);
                  setRows((rs) => rs.filter((r) => r.key !== row.key));
                }}
                className="self-end rounded-lg border border-line-dark p-2 text-on-dark-3 transition-colors hover:text-coral"
                aria-label={`Remove ${row.code || "this code"}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className={caption}>
                  {isRef ? "Commission %" : "Discount %"}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={row.rate}
                  onChange={(e) => patch(row.key, { rate: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={caption}>Limit (optional)</label>
                <input
                  type="number"
                  min="1"
                  value={row.usageLimit}
                  onChange={(e) => patch(row.key, { usageLimit: e.target.value })}
                  placeholder="Unlimited"
                  className={input}
                />
              </div>
              <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm text-on-dark-2">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => patch(row.key, { active: e.target.checked })}
                  className="mb-0.5 accent-[#6C3CFF]"
                />
                Active
              </label>
            </div>

            {/* Only once it has done something. A row of zeroes on a code
                nobody has used yet is noise. */}
            {used > 0 && (
              <p className="mt-3 border-t border-line-dark pt-3 text-sm text-on-dark-2">
                Used {used} {used === 1 ? "time" : "times"}
                {row.usageLimit ? ` of ${row.usageLimit}` : ""} ·{" "}
                {row.tickets ?? 0} {row.tickets === 1 ? "ticket" : "tickets"} ·{" "}
                {naira(row.revenue ?? 0)} in
                {isRef ? (
                  <>
                    {" · "}
                    <span className="font-semibold text-gold">
                      {naira(row.commissionOwed ?? 0)} owed to{" "}
                      {row.promoterName || "them"}
                    </span>
                  </>
                ) : (
                  <>
                    {" · "}
                    <span className="text-on-dark-3">
                      {naira(row.discountGiven ?? 0)} given away
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setRows((rs) => [...rs, blank("discount")]);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
        >
          <Plus className="h-4 w-4" />
          Discount code
        </button>
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setRows((rs) => [...rs, blank("refer_to_earn")]);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-dark px-4 py-2 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
        >
          <Plus className="h-4 w-4" />
          Refer-to-earn code
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-purple px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save codes"}
        </button>
        {saved && <span className="text-sm text-purple-lift">Saved.</span>}
      </div>

      {owed > 0 && (
        // Said plainly, because the alternative is an organiser assuming we
        // handle it and a promoter never being paid.
        <p className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-on-dark-2">
          <span className="font-semibold text-on-dark">
            {naira(owed)} owed to promoters.
          </span>{" "}
          We don&apos;t pay them — this is a record of what you owe, and it
          isn&apos;t deducted from your payout. Settle it however you already
          settle with people.
        </p>
      )}

      <p className="text-xs text-on-dark-3">
        A code that stops working mid-checkout never blocks a sale — the buyer
        pays the normal price instead. Deleting a code keeps the orders that
        used it, and what they were charged.
      </p>
    </div>
  );
}
