"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import {
  Banner,
  border,
  card,
  CopyButton,
  naira,
  Sheet,
  shortDate,
  StatusBadge,
  STATUS,
} from "@/components/payout-ui";

type Person = { name: string | null; email: string } | null;
type Action = "approve" | "process" | "mark_paid" | "mark_failed" | "reject";

type Detail = {
  id: string;
  status: string;
  amount: number;
  requestedAt: string;
  paidAt: string | null;
  organization: { id: string; name: string };
  owner: Person;
  requestedBy: Person;
  bank: { name: string | null; accountName: string | null; accountNumber: string | null };
  paymentReference: string | null;
  availableAtRequest: number | null;
  note: string | null;
  balance: { settledNet: number; unsettledNet: number; paidOut: number; committed: number; available: number; shortfall: number };
  needsReview: boolean;
  allowedActions: Action[];
  events: { id: string; title: string; startsAt: string; status: string; ticketsSold: number; netEarned: number; settledNet: number; unsettledNet: number }[];
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; paymentReference: string | null; createdAt: string; actor: Person }[];
};

/** Button wording, the confirm sheet's title, and what the step means. */
const ACTION_TEXT: Record<Action, { button: string; title: string; explain: string; primary: boolean }> = {
  approve: {
    button: "Approve",
    title: "Approve this payout?",
    explain: "Approving only records that the request checks out. No money moves, and it is not marked paid.",
    primary: true,
  },
  process: {
    button: "Start transfer",
    title: "Start the bank transfer?",
    explain: "Do this when you are about to send the money from Wetin Dey's bank account. You'll mark it paid once the transfer has gone through.",
    primary: true,
  },
  mark_paid: {
    button: "Mark as paid",
    title: "Mark as paid?",
    explain: "Only after you have checked that the money left Wetin Dey's account. This can't be undone.",
    primary: true,
  },
  mark_failed: {
    button: "Transfer failed",
    title: "Record a failed transfer?",
    explain: "The money stays held for this organiser. You can retry the transfer or reject the request afterwards.",
    primary: false,
  },
  reject: {
    button: "Reject",
    title: "Reject this request?",
    explain: "The amount goes back to the organiser's available balance. They will see your reason. This can't be undone.",
    primary: false,
  },
};

const who = (p: Person) => (p ? p.name ?? p.email : "Someone");

/**
 * The history, always starting with the request itself. Requests made before
 * the history table existed have no "requested" row, so one is shown from
 * the request's own date and requester, marked as such.
 */
function historyWithRequest(d: Detail): Detail["history"] {
  if (d.history[0]?.toStatus === "pending") return d.history;
  return [
    {
      id: "requested",
      fromStatus: null,
      toStatus: "pending",
      note: "Requested before payout history was recorded.",
      paymentReference: null,
      createdAt: d.requestedAt,
      actor: d.requestedBy,
    },
    ...d.history,
  ];
}

export default function AdminPayoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);

  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/payouts/${id}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!response.ok) throw new Error(body.error ?? "Couldn't load this request.");
        if (!cancelled) {
          setData(body.request);
          setError(null);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't load this request.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const closeSheet = useCallback(() => {
    if (busy) return;
    setAction(null);
  }, [busy]);

  function open(next: Action) {
    setReason("");
    setReference("");
    setNote("");
    setChecked(false);
    setActionError(null);
    setSuccess(null);
    setAction(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/payouts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, paymentReference: reference, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(body.error ?? "That didn't work. Nothing was changed.");
        // Someone else moved it: show the request as it is now.
        if (response.status === 409) setReloadKey((k) => k + 1);
        return;
      }
      setSuccess(`Done — this request is now ${STATUS[body.to]?.label.toLowerCase() ?? body.to}.`);
      setAction(null);
      setReloadKey((k) => k + 1);
    } catch {
      setActionError("Couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link href="/admin/payouts" className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: "var(--color-purple)" }}>
      <ArrowLeft className="h-4 w-4" />
      All payouts
    </Link>
  );

  if (notFound) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {back}
        <p className={`${card} mt-4`} style={{ ...border, color: "var(--color-stone)" }}>
          This payout request doesn&apos;t exist.
        </p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
        {back}
        <Banner tone="error">{error}</Banner>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--color-purple)" }}
        >
          Try again
        </button>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {back}
        <div className={`${card} mt-4 animate-pulse`} style={border}>
          <div className="h-5 w-1/2 rounded" style={{ backgroundColor: "var(--color-ivory-2)" }} />
          <div className="mt-4 h-8 w-1/3 rounded" style={{ backgroundColor: "var(--color-ivory-2)" }} />
        </div>
      </main>
    );
  }

  const d = data;
  const accountNumber = d.bank.accountNumber ?? "";
  const label = { color: "var(--color-stone-mid)" };
  const ink = { color: "var(--color-forest)" };
  const text = ACTION_TEXT;
  const isRetry = action === "process" && d.status === "failed";
  const canSubmit =
    !busy &&
    (action !== "reject" || reason.trim().length >= 10) &&
    (action !== "mark_paid" || (reference.trim().length >= 4 && checked));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {back}

      {success && (
        <div className="mt-4">
          <Banner tone="ok">{success}</Banner>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ── Left: who, how much, where, and what to do ── */}
        <div className="space-y-4">
          <section className={card} style={border}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-lg font-bold" style={ink}>
                  {d.organization.name}
                </h1>
                <p className="text-sm" style={{ color: "var(--color-stone)" }}>
                  Owner: {who(d.owner)}
                  {d.owner?.email && d.owner.name ? ` · ${d.owner.email}` : ""}
                </p>
                <p className="text-xs" style={label}>
                  Requested {shortDate(d.requestedAt, true)}
                  {d.requestedBy ? ` by ${who(d.requestedBy)}` : ""}
                </p>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wide" style={label}>
              Amount requested
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-3xl font-extrabold tracking-tight" style={ink}>
                {naira(d.amount)}
              </p>
              <CopyButton value={d.amount.toFixed(2)} label="Copy amount" />
            </div>

            {d.needsReview && (
              <div className="mt-4 flex gap-2 rounded-lg p-3 text-sm" style={{ backgroundColor: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Needs review: this organiser&apos;s open requests are {naira(d.balance.shortfall)} more than the money
                  Paystack has settled. Check before approving or paying.
                </p>
              </div>
            )}
            {d.status === "paid" && (
              <p className="mt-4 text-sm" style={{ color: "var(--color-success)" }}>
                Paid {shortDate(d.paidAt, true)} · transfer reference <strong>{d.paymentReference}</strong>
              </p>
            )}
            {d.note && d.status !== "paid" && (
              <p className="mt-4 text-sm" style={{ color: "var(--color-stone)" }}>
                {d.status === "rejected" ? "Reason given to the organiser: " : "Note shown to the organiser: "}
                {d.note}
              </p>
            )}
          </section>

          <section className={card} style={border}>
            <h2 className="text-sm font-bold uppercase tracking-wide" style={label}>
              Send it to
            </h2>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-xs" style={label}>Bank</dt>
                <dd className="font-semibold" style={ink}>{d.bank.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs" style={label}>Account name</dt>
                <dd className="font-semibold" style={ink}>{d.bank.accountName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs" style={label}>Account number</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xl font-bold tracking-wider" style={ink}>
                    {accountNumber || "—"}
                  </span>
                  {accountNumber && <CopyButton value={accountNumber} label="Copy account number" />}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs" style={label}>
              These are the details saved with the request. If the organiser changes their bank account later, this
              request still shows where they asked for the money to go.
            </p>
          </section>

          {d.allowedActions.length > 0 && (
            <section className={card} style={border}>
              <h2 className="text-sm font-bold uppercase tracking-wide" style={label}>
                Next step
              </h2>
              {d.status === "approved" && (
                <p className="mt-2 text-sm" style={{ color: "var(--color-stone)" }}>
                  Press &ldquo;Start transfer&rdquo; when you send the money from Wetin Dey&apos;s bank account.
                </p>
              )}
              {d.status === "processing" && (
                <p className="mt-2 text-sm" style={{ color: "var(--color-stone)" }}>
                  Once your bank confirms the transfer went through, mark it paid with the transfer reference.
                </p>
              )}
              <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                {d.allowedActions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => open(a)}
                    className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold"
                    style={
                      text[a].primary
                        ? { backgroundColor: "var(--color-purple)", color: "white" }
                        : { border: "1px solid var(--color-line)", color: a === "reject" ? "var(--color-danger)" : "var(--color-stone)" }
                    }
                  >
                    {a === "process" && d.status === "failed" ? "Retry transfer" : text[a].button}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Right: the money behind it, and what happened ── */}
        <div className="space-y-4">
          <section className={card} style={border}>
            <h2 className="text-sm font-bold uppercase tracking-wide" style={label}>
              Organiser balance now
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ["Settled by Paystack", d.balance.settledNet],
                ["Waiting for Paystack", d.balance.unsettledNet],
                ["Already paid out", d.balance.paidOut],
                ["Requested, not yet paid (incl. this)", d.balance.committed],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4">
                  <dt style={{ color: "var(--color-stone)" }}>{k}</dt>
                  <dd className="font-semibold" style={ink}>{naira(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t pt-2" style={border}>
                <dt className="font-semibold" style={ink}>Still available</dt>
                <dd className="font-bold" style={ink}>{naira(d.balance.available)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs" style={label}>
              {d.availableAtRequest === null
                ? "Available-at-request wasn't recorded (requested before this was tracked)."
                : `When they asked, ${naira(d.availableAtRequest)} was available.`}
            </p>
          </section>

          <section className={card} style={border}>
            <h2 className="text-sm font-bold uppercase tracking-wide" style={label}>
              Events with sales
            </h2>
            {d.events.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: "var(--color-stone)" }}>No ticket sales found.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {d.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="font-semibold" style={ink}>{e.title}</p>
                    <p className="text-xs" style={label}>
                      {shortDate(e.startsAt)} · {e.ticketsSold} {e.ticketsSold === 1 ? "ticket" : "tickets"} · net {naira(e.netEarned)}
                      {e.unsettledNet > 0 ? ` (${naira(e.unsettledNet)} waiting)` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} style={border}>
            <h2 className="text-sm font-bold uppercase tracking-wide" style={label}>
              History
            </h2>
            <ol className="mt-3 space-y-3 border-l pl-4" style={border}>
                {historyWithRequest(d).map((h) => (
                  <li key={h.id} className="text-sm">
                    <p style={ink}>
                      <strong>{h.toStatus === "pending" ? "Requested" : STATUS[h.toStatus]?.label ?? h.toStatus}</strong> · {who(h.actor)}
                    </p>
                    <p className="text-xs" style={label}>{shortDate(h.createdAt, true)}</p>
                    {h.paymentReference && (
                      <p className="text-xs" style={{ color: "var(--color-stone)" }}>Reference {h.paymentReference}</p>
                    )}
                    {h.note && <p className="text-xs" style={{ color: "var(--color-stone)" }}>{h.note}</p>}
                  </li>
                ))}
            </ol>
          </section>
        </div>
      </div>

      {action && (
        <Sheet title={isRetry ? "Retry the bank transfer?" : text[action].title} onClose={closeSheet}>
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: "var(--color-ivory)" }}>
              <p className="text-xl font-extrabold" style={ink}>{naira(d.amount)}</p>
              <p style={{ color: "var(--color-stone)" }}>
                to {d.bank.accountName ?? "—"} · {d.bank.name ?? "—"} · {accountNumber || "—"}
              </p>
              <p className="text-xs" style={label}>{d.organization.name}</p>
            </div>
            <p className="text-sm" style={{ color: "var(--color-stone)" }}>{text[action].explain}</p>

            {action === "reject" && (
              <label className="block text-sm font-semibold" style={ink}>
                Reason (the organiser will see this)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  required
                  className="mt-1 w-full rounded-lg border p-2 font-normal"
                  style={border}
                  placeholder="At least 10 characters"
                />
              </label>
            )}

            {action === "mark_paid" && (
              <>
                <label className="block text-sm font-semibold" style={ink}>
                  Bank transfer reference
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={120}
                    required
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border p-2 font-mono font-normal"
                    style={border}
                    placeholder="From your bank's transfer receipt"
                  />
                </label>
                <label className="flex items-start gap-2 text-sm" style={ink}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  I&apos;ve checked that this money left Wetin Dey&apos;s bank account.
                </label>
              </>
            )}

            {(action === "approve" || action === "process" || action === "mark_failed" || action === "mark_paid") && (
              <label className="block text-sm font-semibold" style={ink}>
                {action === "mark_failed" ? "What went wrong (the organiser will see this)" : "Note (optional, kept in the history)"}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border p-2 font-normal"
                  style={border}
                />
              </label>
            )}

            {actionError && <Banner tone="error">{actionError}</Banner>}

            <div className="grid gap-2 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={!canSubmit}
                className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: action === "reject" ? "var(--color-danger)" : "var(--color-purple)" }}
              >
                {busy ? "Saving…" : isRetry ? "Retry transfer" : text[action].button}
              </button>
              <button
                type="button"
                onClick={closeSheet}
                disabled={busy}
                className="min-h-[44px] rounded-lg border px-4 py-2 text-sm font-semibold"
                style={{ ...border, color: "var(--color-stone)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </main>
  );
}
