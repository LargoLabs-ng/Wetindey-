"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Banknote, Check, Clock, Wallet } from "lucide-react";
import { naira, PLATFORM_FEE_RATE } from "@/lib/fees";

type Earnings = {
  grossSales: number;
  platformFee: number;
  processingFee: number;
  refunded: number;
  netEarned: number;
  paidOut: number;
  pending: number;
  available: number;
  ticketsSold: number;
};

type Payout = {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  note: string | null;
  bankName: string | null;
  accountNumberLast4: string;
};

type Finance = {
  earnings: Earnings;
  bank: {
    name: string;
    accountName: string;
    accountNumberLast4: string;
    set: boolean;
  };
  history: Payout[];
};

/**
 * Finance — what you earned, and how to get it.
 *
 * This page exists because the product could take money and had no way to
 * give it back. There was a payouts table and a per-event revenue
 * calculation, and nowhere for an organiser to put a bank account.
 *
 * Account-level on purpose: "how much can I withdraw" is never a question
 * about one event.
 */
export default function FinancePage() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/finance");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? "Couldn't load your finances.");
        return;
      }
      const d: Finance = await r.json();
      setData(d);
      setBankName(d.bank.name);
      setAccountName(d.bank.accountName);
      setError(null);
    } catch {
      setError("Couldn't load your finances.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(payload: unknown, done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error ?? "That didn't work.");
        return;
      }
      setSaved(done);
      setAccountNumber("");
      setAmount("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const card = "rounded-2xl border border-line-dark bg-surface p-5";
  const field =
    "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-gold";
  const label = "mb-1 block text-sm font-medium text-on-dark-2";

  if (error && !data) {
    return (
      <div className={card}>
        <p className="font-semibold text-on-dark">{error}</p>
      </div>
    );
  }

  if (!data) return <p className="text-on-dark-3">Loading…</p>;

  const e = data.earnings;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-on-dark">Finance</h1>
        <p className="mt-1 text-sm text-on-dark-2">
          What you&apos;ve earned, what we took, and what you can withdraw.
        </p>
      </div>

      {/* ── The one number they came for ──────────────────────────────── */}
      <div className="rounded-2xl border border-line-dark bg-surface p-6">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-dark-3">
          Available to withdraw
        </p>
        <p className="mt-2 text-4xl font-extrabold tracking-[-0.03em] text-on-dark">
          {naira(e.available)}
        </p>
        <p className="mt-2 text-sm text-on-dark-3">
          Net earned {naira(e.netEarned)} · paid out {naira(e.paidOut)} ·
          pending {naira(e.pending)}
        </p>
      </div>

      {/* ── How it got there ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={card}>
          <p className="text-sm text-on-dark-2">Ticket sales</p>
          <p className="mt-1 text-2xl font-bold text-on-dark">
            {naira(e.grossSales)}
          </p>
          <p className="mt-1 text-xs text-on-dark-3">
            {e.ticketsSold} {e.ticketsSold === 1 ? "ticket" : "tickets"}, face
            value
          </p>
        </div>
        <div className={card}>
          <p className="text-sm text-on-dark-2">Fees you carried</p>
          <p className="mt-1 text-2xl font-bold text-on-dark">
            − {naira(e.platformFee + e.processingFee)}
          </p>
          {/* Split out because they are two different people's money, and an
              organiser who thinks we took all of it is owed an explanation. */}
          <p className="mt-1 text-xs text-on-dark-3">
            Us {naira(e.platformFee)} ({Math.round(PLATFORM_FEE_RATE * 100)}%) ·
            Paystack {naira(e.processingFee)}
          </p>
        </div>
        <div className={card}>
          <p className="text-sm text-on-dark-2">Refunded</p>
          <p className="mt-1 text-2xl font-bold text-on-dark">
            {naira(e.refunded)}
          </p>
          <p className="mt-1 text-xs text-on-dark-3">
            Sales returned to buyers
          </p>
        </div>
      </div>

      {/* ── Bank account ──────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="flex items-center gap-2 font-bold text-on-dark">
          <Banknote className="h-4 w-4 text-gold" />
          Where we send it
        </h2>

        {data.bank.set && (
          <p className="mt-2 text-sm text-on-dark-2">
            Currently {data.bank.name} ···· {data.bank.accountNumberLast4} —{" "}
            {data.bank.accountName}
          </p>
        )}

        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault();
            post(
              { action: "bank", bankName, accountName, accountNumber },
              "Bank details saved."
            );
          }}
        >
          <div>
            <label className={label} htmlFor="bankName">
              Bank
            </label>
            <input
              id="bankName"
              value={bankName}
              onChange={(ev) => setBankName(ev.target.value)}
              placeholder="e.g. GTBank"
              required
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="accountName">
              Account name
            </label>
            <input
              id="accountName"
              value={accountName}
              onChange={(ev) => setAccountName(ev.target.value)}
              required
              className={field}
            />
          </div>
          <div>
            <label className={label} htmlFor="accountNumber">
              Account number
            </label>
            <input
              id="accountNumber"
              value={accountNumber}
              onChange={(ev) => setAccountNumber(ev.target.value)}
              inputMode="numeric"
              placeholder={data.bank.set ? "Enter to replace" : "10 digits"}
              required
              className={field}
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-surface-2 px-4 py-2 font-semibold text-on-dark transition-colors hover:bg-line-dark disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save bank details"}
            </button>
          </div>
        </form>
      </section>

      {/* ── The request ───────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="flex items-center gap-2 font-bold text-on-dark">
          <Wallet className="h-4 w-4 text-gold" />
          Request a payout
        </h2>

        {!data.bank.set ? (
          <p className="mt-2 text-sm text-on-dark-2">
            Add your bank account above first.
          </p>
        ) : e.available <= 0 ? (
          <p className="mt-2 text-sm text-on-dark-2">
            Nothing available to withdraw yet.
          </p>
        ) : (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(ev: FormEvent) => {
              ev.preventDefault();
              post(
                { action: "withdraw", amount: Number(amount) },
                "Payout requested."
              );
            }}
          >
            <div className="min-w-[180px]">
              <label className={label} htmlFor="amount">
                Amount
              </label>
              <input
                id="amount"
                value={amount}
                onChange={(ev) => setAmount(ev.target.value)}
                inputMode="decimal"
                placeholder="0"
                required
                className={field}
              />
            </div>
            <button
              type="button"
              onClick={() => setAmount(String(e.available))}
              className="rounded-lg border border-line-dark px-3 py-2 text-sm font-semibold text-on-dark-2 hover:text-on-dark"
            >
              All of it
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2 font-semibold text-canvas transition-colors hover:bg-gold-deep disabled:opacity-60"
            >
              {busy ? "Requesting…" : "Request payout"}
            </button>
          </form>
        )}

        {/* Said plainly, because "Request payout" sounds instant and isn't.
            An organiser who thinks the money is on its way and finds nothing
            an hour later stops trusting the number above it. */}
        <p className="mt-3 text-xs text-on-dark-3">
          Requests are reviewed and paid by hand — this doesn&apos;t move money
          on its own. You&apos;ll see it below as pending until it&apos;s sent.
        </p>
      </section>

      {error && <p className="text-sm text-error">{error}</p>}
      {saved && (
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <Check className="h-4 w-4" />
          {saved}
        </p>
      )}

      {/* ── History ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 font-bold text-on-dark">Payout history</h2>
        {data.history.length === 0 ? (
          <div className={card}>
            <p className="text-sm text-on-dark-2">No payouts yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line-dark bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-dark text-on-dark-3">
                  <th className="px-5 py-3 font-semibold">Requested</th>
                  <th className="px-5 py-3 font-semibold">To</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  <th className="px-5 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((p) => (
                  <tr key={p.id} className="border-b border-line-dark last:border-0">
                    <td className="px-5 py-3 text-on-dark-2">
                      {new Date(p.requestedAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3 text-on-dark-2">
                      {p.bankName} ···· {p.accountNumberLast4}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-on-dark">
                      {naira(p.amount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.status === "paid"
                            ? "bg-success/25 text-sage"
                            : p.status === "failed"
                              ? "bg-error/15 text-error"
                              : "bg-warning/15 text-warning"
                        }`}
                      >
                        {p.status === "paid" ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {p.status}
                      </span>
                      {p.note && (
                        <p className="mt-1 text-xs text-on-dark-3">{p.note}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
