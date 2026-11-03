"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, RotateCcw } from "lucide-react";

type EventAnalytics = {
  event: {
    id: string;
    title: string;
    slug: string;
    status: string;
    archivedAt: string | null;
    startDatetime: string;
    endDatetime: string;
    venue: string;
    organizer: string;
    organizerName: string | null;
    organizerEmail: string | null;
  };
  metrics: {
    ticketsSold: number;
    checkedIn: number;
    paidOrders: number;
    totalRevenue: number;
    totalRefunded: number;
    ticketTypes: number;
  };
  ticketTypes: Array<{
    id: string;
    name: string;
    price: string;
    status: string;
    quantityTotal: number;
    quantitySold: number;
    ticketsSold: number;
  }>;
  monthlySales: Array<{ month: string; orders: number; revenue: number }>;
};

async function fetchEventAnalytics(eventId: string): Promise<EventAnalytics> {
  const response = await fetch(`/api/admin/events/${eventId}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load event analytics.");
  return result as EventAnalytics;
}

function formatCurrency(amount: number) {
  return `₦${amount.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminEventAnalytics({ eventId }: { eventId: string }) {
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchEventAnalytics(eventId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load event analytics.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  async function toggleArchive() {
    if (!data) return;
    const action = data.event.archivedAt ? "restore" : "archive";
    const prompt = action === "archive"
      ? "Archive this event? It will disappear from public pages and ticket sales, but all ticket and payment history will be preserved."
      : "Restore this event? It will remain unpublished until the organiser publishes it again.";
    if (!window.confirm(prompt)) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update event.");
      setData((current) => current
        ? {
            ...current,
            event: {
              ...current.event,
              status: result.event.status,
              archivedAt: result.event.archivedAt,
            },
          }
        : current);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update event.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/events" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-forest hover:opacity-75">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      {error && <p role="alert" className="my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {loading || !data ? (
        <div className="rounded-xl border border-stone-mid bg-white p-10 text-center text-stone">
          {loading ? "Loading event analytics…" : "Event analytics could not be loaded."}
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-stone-mid">Event analytics</p>
              <h1 className="mt-1 text-3xl font-bold text-forest">{data.event.title}</h1>
              <p className="mt-2 text-sm text-stone">
                {data.event.organizer} · {data.event.organizerEmail ?? "No organiser email"}
              </p>
              <p className="mt-1 text-sm text-stone-mid">{data.event.venue} · {new Date(data.event.startDatetime).toLocaleString("en-NG")}</p>
              <p className="mt-1 text-xs text-stone-mid">
                Status: {data.event.archivedAt ? "Archived" : data.event.status}
                {data.event.archivedAt ? ` · ${new Date(data.event.archivedAt).toLocaleString("en-NG")}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleArchive()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-mid bg-white px-4 py-2 text-sm font-semibold text-forest disabled:opacity-50"
            >
              {data.event.archivedAt ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {busy ? "Saving…" : data.event.archivedAt ? "Restore event" : "Archive event"}
            </button>
          </header>

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Tickets sold", data.metrics.ticketsSold.toLocaleString("en-NG")],
              ["Checked in", data.metrics.checkedIn.toLocaleString("en-NG")],
              ["Paid orders", data.metrics.paidOrders.toLocaleString("en-NG")],
              ["Paid revenue", formatCurrency(data.metrics.totalRevenue)],
              ["Refunded", formatCurrency(data.metrics.totalRefunded)],
            ].map(([label, value]) => (
              <article key={label} className="rounded-xl border border-stone-mid bg-white p-5">
                <p className="text-sm text-stone-mid">{label}</p>
                <p className="mt-2 text-2xl font-bold text-forest">{value}</p>
              </article>
            ))}
          </section>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-stone-mid bg-white">
              <div className="border-b border-stone-mid px-5 py-4">
                <h2 className="font-bold text-forest">Ticket types</h2>
              </div>
              {data.ticketTypes.length === 0 ? (
                <p className="p-5 text-sm text-stone-mid">No ticket types for this event.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-ivory text-stone">
                      <tr><th className="px-5 py-3">Tier</th><th className="px-5 py-3">Price</th><th className="px-5 py-3">Sold</th><th className="px-5 py-3">Capacity</th></tr>
                    </thead>
                    <tbody>
                      {data.ticketTypes.map((ticketType) => (
                        <tr key={ticketType.id} className="border-t border-stone-mid">
                          <td className="px-5 py-3"><p className="font-semibold text-forest">{ticketType.name}</p><p className="text-xs text-stone-mid">{ticketType.status}</p></td>
                          <td className="px-5 py-3 text-stone">{formatCurrency(Number(ticketType.price))}</td>
                          <td className="px-5 py-3 text-stone">{ticketType.ticketsSold}</td>
                          <td className="px-5 py-3 text-stone">{ticketType.quantityTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border border-stone-mid bg-white">
              <div className="border-b border-stone-mid px-5 py-4">
                <h2 className="font-bold text-forest">Monthly sales</h2>
              </div>
              {data.monthlySales.length === 0 ? (
                <p className="p-5 text-sm text-stone-mid">No paid orders yet.</p>
              ) : (
                <div className="divide-y divide-stone-mid">
                  {data.monthlySales.map((month) => (
                    <div key={month.month} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div><p className="font-semibold text-forest">{new Date(`${month.month}-01T00:00:00`).toLocaleDateString("en-NG", { month: "long", year: "numeric" })}</p><p className="text-xs text-stone-mid">{month.orders} paid orders</p></div>
                      <p className="font-semibold text-forest">{formatCurrency(month.revenue)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
