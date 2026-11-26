"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
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
  /** Linked team member (event_staff id), "" for none. Referral codes only. */
  staffId: string;
  rate: string;
  usageLimit: string;
  active: boolean;
  /** true: every ticket type. false: only `ticketTypeIds`. */
  appliesToAllTiers: boolean;
  ticketTypeIds: string[];
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
    staffId: "",
    rate: kind === "discount" ? "10" : "5",
    usageLimit: "",
    active: true,
    appliesToAllTiers: true,
    ticketTypeIds: [],
  };
}

type Tier = { id: string; name: string };
type TeamMember = { id: string; name: string };

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
  appliesToAllTiers?: boolean;
  ticketTypeIds?: string[];
  staffId?: string | null;
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
    staffId: c.staffId ?? "",
    rate: String(c.rate),
    usageLimit: c.usageLimit === null ? "" : String(c.usageLimit),
    active: c.active,
    appliesToAllTiers: c.appliesToAllTiers ?? true,
    ticketTypeIds: c.ticketTypeIds ?? [],
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
  /** This event's ticket types, for "Only some ticket types". */
  const [tiers, setTiers] = useState<Tier[]>([]);
  /** Team members a referral code can be linked to. */
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/ticket-types`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list: Tier[] = (Array.isArray(data) ? data : data.ticketTypes ?? []).map(
          (t: Tier) => ({ id: t.id, name: t.name })
        );
        setTiers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId]);

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
        if (!cancelled) {
          setRows((data.codes ?? []).map(toRow));
          setTeam(data.team ?? []);
        }
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
          appliesToAllTiers: r.appliesToAllTiers,
          staffId: r.kind === "refer_to_earn" ? r.staffId || null : null,
          // Only tiers that still exist: one deleted since loading would be
          // refused by the server as "not on this event".
          ticketTypeIds: r.appliesToAllTiers
            ? []
            : r.ticketTypeIds.filter((id) => tiers.some((t) => t.id === id)),
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
    if (data.team) setTeam(data.team);
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
                className="flex min-h-11 min-w-11 items-center justify-center self-end justify-self-end rounded-lg border border-line-dark text-on-dark-3 transition-colors hover:text-coral"
                aria-label={`Remove ${row.code || "this code"}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {isRef && team.length > 0 && (
              <div className="mt-3">
                <label htmlFor={`owner-${row.key}`} className={caption}>
                  Their Wetin Dey account (optional)
                </label>
                <select
                  id={`owner-${row.key}`}
                  value={row.staffId}
                  onChange={(e) => {
                    const staffId = e.target.value;
                    const member = team.find((m) => m.id === staffId);
                    patch(row.key, {
                      staffId,
                      // Fill the name in for them, but never overwrite one
                      // they've typed.
                      ...(member && !row.promoterName.trim()
                        ? { promoterName: member.name }
                        : {}),
                    });
                  }}
                  className={`${input} min-h-11`}
                >
                  <option value="">Not linked</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-on-dark-3">
                  If they&apos;re on your team, link them so they can&apos;t
                  earn commission on tickets they buy themselves.
                </p>
              </div>
            )}

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

            <TierScope
              row={row}
              tiers={tiers}
              onChange={(next) => patch(row.key, next)}
            />

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
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-dark px-4 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
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
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-dark px-4 text-sm font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
        >
          <Plus className="h-4 w-4" />
          Refer-to-earn code
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="min-h-11 rounded-lg bg-purple px-5 text-sm font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save codes"}
        </button>
        {saved && <span className="text-sm text-purple-lift">Saved.</span>}
      </div>

      {/* Repeated beside the button: on a phone the message at the top of
          the editor is a long scroll away from where Save was tapped. */}
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      {owed > 0 && (
        // Said plainly, because the alternative is an organiser assuming we
        // handle it and a promoter never being paid.
        <p className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-on-dark-2">
          <span className="font-semibold text-on-dark">
            {naira(owed)} owed to promoters.
          </span>{" "}
          Refunded and cancelled tickets are already taken off. We don&apos;t
          pay promoters — this is a record of what you owe, and it isn&apos;t
          deducted from your payout. Settle it however you already settle
          with people.
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

/**
 * "Works on": every ticket type, or only the ones ticked.
 *
 * Phone-first: two full-width halves of one control, then ticket types as
 * large tappable chips that wrap — no dropdowns, nothing smaller than a
 * thumb (44px tall).
 */
function TierScope({
  row,
  tiers,
  onChange,
}: {
  row: Row;
  tiers: Tier[];
  onChange: (next: Partial<Row>) => void;
}) {
  const limited = !row.appliesToAllTiers;
  // Tiers deleted since this code was limited are not shown or sent.
  const picked = row.ticketTypeIds.filter((id) => tiers.some((t) => t.id === id));
  // Selected = the dashboard's accent colour (the `gold` token), so it reads
  // at a glance on a phone in either theme. `bg-purple` sits too close to
  // the dashboard background to tell on from off.
  const segment = (on: boolean) =>
    `min-h-11 rounded-lg border px-3 text-sm font-semibold transition-colors ${
      on
        ? "border-gold bg-gold/15 text-on-dark"
        : "border-line-dark text-on-dark-2 hover:text-on-dark"
    }`;

  return (
    <fieldset className="mt-4">
      <legend className={caption}>Works on</legend>
      <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
        <button
          type="button"
          aria-pressed={!limited}
          onClick={() => onChange({ appliesToAllTiers: true })}
          className={segment(!limited)}
        >
          All ticket types
        </button>
        <button
          type="button"
          aria-pressed={limited}
          disabled={tiers.length === 0}
          onClick={() => onChange({ appliesToAllTiers: false, ticketTypeIds: picked })}
          className={`${segment(limited)} disabled:opacity-40`}
        >
          Only some
        </button>
      </div>

      {tiers.length === 0 && (
        <p className="mt-2 text-xs text-on-dark-3">
          Add ticket types first to limit a code to some of them.
        </p>
      )}

      {limited && tiers.length > 0 && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {tiers.map((t) => {
              const on = picked.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      ticketTypeIds: on
                        ? picked.filter((id) => id !== t.id)
                        : [...picked, t.id],
                    })
                  }
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
                    on
                      ? "border-gold bg-gold/15 font-semibold text-on-dark"
                      : "border-line-dark text-on-dark-2 hover:text-on-dark"
                  }`}
                >
                  {on && <Check className="h-4 w-4 text-gold" />}
                  {t.name}
                </button>
              );
            })}
          </div>
          <p
            className={`mt-2 text-xs ${
              picked.length === 0 ? "text-coral" : "text-on-dark-3"
            }`}
          >
            {picked.length === 0
              ? "Pick at least one ticket type."
              : `Buyers can only use ${row.code || "this code"} on ${picked
                  .map((id) => tiers.find((t) => t.id === id)?.name)
                  .join(", ")}.`}
          </p>
        </>
      )}
    </fieldset>
  );
}
