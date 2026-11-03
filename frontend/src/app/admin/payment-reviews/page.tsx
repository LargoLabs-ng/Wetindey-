"use client";

import { useCallback, useEffect, useState } from "react";

type Review = {
  id: string;
  reference: string;
  amount: string;
  providerAmount: number | null;
  providerFee: number | null;
  reason: string | null;
  paidAt: string | null;
  order: {
    email: string;
    total: string;
    ticketUnitPrice: string | null;
    eventTitle: string;
    tickets: number;
  };
};

export default function PaymentReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/admin/payment-reviews");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load payment reviews.");
      setReviews(data.reviews ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load payment reviews.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/payment-reviews");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load payment reviews.");
        if (!cancelled) setReviews(data.reviews ?? []);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load payment reviews.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function resolve(paymentId: string) {
    setBusy(paymentId);
    setError(null);
    try {
      const response = await fetch("/api/admin/payment-reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, note: notes[paymentId] ?? "" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not resolve this review.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not resolve this review.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold" style={{ color: "var(--color-forest)" }}>
        Payment reviews
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--color-stone)" }}>
        A price changed after checkout, so no ticket was issued. Verify the Paystack
        transaction, refund or document the decision, then record what you did.
      </p>
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? (
        <p className="mt-6">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="mt-6 rounded-xl border p-5">No open payment reviews.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {reviews.map((review) => (
            <section key={review.id} className="rounded-xl border bg-white p-5">
              <h2 className="font-bold">{review.order.eventTitle}</h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold">Buyer</dt><dd>{review.order.email}</dd></div>
                <div><dt className="font-semibold">Paystack reference</dt><dd>{review.reference}</dd></div>
                <div><dt className="font-semibold">Checkout base before provider fees</dt><dd>₦{Number(review.amount).toLocaleString("en-NG")}</dd></div>
                <div><dt className="font-semibold">Actual Paystack charge</dt><dd>{review.providerAmount === null ? "Unavailable" : `₦${review.providerAmount.toLocaleString("en-NG")}`}</dd></div>
                <div><dt className="font-semibold">Paystack fee</dt><dd>{review.providerFee === null ? "Unavailable" : `₦${review.providerFee.toLocaleString("en-NG")}`}</dd></div>
                <div><dt className="font-semibold">Checkout unit price</dt><dd>{review.order.ticketUnitPrice === null ? "Unavailable" : `₦${Number(review.order.ticketUnitPrice).toLocaleString("en-NG")}`}</dd></div>
                <div><dt className="font-semibold">Tickets held</dt><dd>{review.order.tickets}</dd></div>
                <div><dt className="font-semibold">Paid</dt><dd>{review.paidAt ? new Date(review.paidAt).toLocaleString() : "—"}</dd></div>
              </dl>
              <p className="mt-3 text-sm text-red-700">{review.reason}</p>
              <label className="mt-4 block text-sm font-semibold">
                Review outcome / refund reference
                <textarea
                  value={notes[review.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [review.id]: event.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-lg border p-2 font-normal"
                  placeholder="Record the refund or other resolution (minimum 10 characters)."
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || (notes[review.id] ?? "").trim().length < 10}
                onClick={() => void resolve(review.id)}
                className="mt-3 rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === review.id ? "Saving…" : "Mark reviewed"}
              </button>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
