"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";

export type Tier = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  quantityTotal: number;
  quantitySold: number;
  maxPerOrder: number;
  status: string;
  salesStart: string | null;
  salesEnd: string | null;
};

const naira = (value: string | number) =>
  Number(value) === 0
    ? "Free"
    : `₦${Number(value).toLocaleString("en-NG", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

const statusStyles: Record<string, string> = {
  active: "bg-success/25 text-sage",
  paused: "bg-warning/15 text-warning",
  sold_out: "bg-surface-2 text-on-dark-2",
};

const statusLabels: Record<string, string> = {
  active: "On sale",
  paused: "Paused",
  sold_out: "Sold out",
};

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const fieldClass =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-gold";
const labelClass = "mb-1 block text-sm font-medium text-on-dark-2";

type FormValues = {
  name: string;
  price: string;
  quantityTotal: string;
  maxPerOrder: string;
  description: string;
  salesStart: string;
  salesEnd: string;
};

const emptyForm: FormValues = {
  name: "",
  price: "",
  quantityTotal: "",
  maxPerOrder: "10",
  description: "",
  salesStart: "",
  salesEnd: "",
};

function TierForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const [showExtras, setShowExtras] = useState(
    Boolean(initial.description || initial.salesStart || initial.salesEnd)
  );

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="space-y-4 rounded-xl border border-line-dark bg-canvas p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Name</label>
          <input
            required
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Early Bird"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>Price (₦)</label>
          <input
            required
            type="number"
            min="0"
            step="1"
            value={values.price}
            onChange={(e) => set("price", e.target.value)}
            placeholder="0 for a free ticket"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>Quantity</label>
          <input
            required
            type="number"
            min="1"
            step="1"
            value={values.quantityTotal}
            onChange={(e) => set("quantityTotal", e.target.value)}
            placeholder="e.g. 100"
            className={fieldClass}
          />
        </div>

        <div>
          <label className={labelClass}>Max per order</label>
          <input
            required
            type="number"
            min="1"
            max="50"
            step="1"
            value={values.maxPerOrder}
            onChange={(e) => set("maxPerOrder", e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowExtras((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-on-dark-2 transition-colors hover:text-gold"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${showExtras ? "rotate-180" : ""}`}
        />
        Description and sales window
      </button>

      {showExtras && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea
              rows={2}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What this ticket includes"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Sales start</label>
            <input
              type="datetime-local"
              value={values.salesStart}
              onChange={(e) => set("salesStart", e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Sales end</label>
            <input
              type="datetime-local"
              value={values.salesEnd}
              onChange={(e) => set("salesEnd", e.target.value)}
              className={fieldClass}
            />
          </div>
          <p className="text-xs text-on-dark-3 sm:col-span-2">
            Leave both blank to sell from now until the event starts.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-gold px-4 py-2 font-semibold text-canvas transition-colors hover:bg-gold-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm font-medium text-on-dark-2 transition-colors hover:text-on-dark"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TicketTiers({
  eventId,
  tiers,
}: {
  eventId: string;
  tiers: Tier[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function payloadFrom(values: FormValues) {
    return {
      name: values.name.trim(),
      price: Number(values.price),
      quantityTotal: Number(values.quantityTotal),
      maxPerOrder: Number(values.maxPerOrder),
      description: values.description.trim() || undefined,
      salesStart: values.salesStart ? new Date(values.salesStart).toISOString() : null,
      salesEnd: values.salesEnd ? new Date(values.salesEnd).toISOString() : null,
    };
  }

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(values: FormValues) {
    const ok = await send(
      `/api/events/${eventId}/ticket-types`,
      "POST",
      payloadFrom(values)
    );
    if (ok) setAdding(false);
  }

  async function update(id: string, values: FormValues) {
    const ok = await send(`/api/ticket-types/${id}`, "PATCH", payloadFrom(values));
    if (ok) setEditingId(null);
  }

  async function toggleStatus(tier: Tier) {
    await send(`/api/ticket-types/${tier.id}`, "PATCH", {
      status: tier.status === "paused" ? "active" : "paused",
    });
  }

  async function remove(id: string) {
    const ok = await send(`/api/ticket-types/${id}`, "DELETE");
    if (ok) setConfirmDeleteId(null);
  }

  return (
    <section className="rounded-2xl border border-line-dark bg-surface">
      <div className="flex items-center justify-between gap-4 border-b border-line-dark px-6 py-4">
        <div>
          <h2 className="font-bold text-on-dark">Ticket types</h2>
          <p className="text-sm text-on-dark-2">
            {tiers.length === 0
              ? "An event needs at least one before anyone can buy."
              : `${tiers.length} tier${tiers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setError(null);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gold px-3.5 py-2 text-sm font-semibold text-canvas transition-colors hover:bg-gold-deep"
          >
            <Plus className="h-4 w-4" />
            Add ticket type
          </button>
        )}
      </div>

      <div className="space-y-4 p-6">
        {adding && (
          <TierForm
            initial={emptyForm}
            submitLabel="Create ticket type"
            onSubmit={create}
            onCancel={() => {
              setAdding(false);
              setError(null);
            }}
            busy={busy}
            error={error}
          />
        )}

        {tiers.length === 0 && !adding && (
          <p className="py-6 text-center text-on-dark-2">
            No ticket types yet.
          </p>
        )}

        {tiers.map((tier) =>
          editingId === tier.id ? (
            <TierForm
              key={tier.id}
              initial={{
                name: tier.name,
                price: String(Number(tier.price)),
                quantityTotal: String(tier.quantityTotal),
                maxPerOrder: String(tier.maxPerOrder),
                description: tier.description ?? "",
                salesStart: toLocalInput(tier.salesStart),
                salesEnd: toLocalInput(tier.salesEnd),
              }}
              submitLabel="Save changes"
              onSubmit={(values) => update(tier.id, values)}
              onCancel={() => {
                setEditingId(null);
                setError(null);
              }}
              busy={busy}
              error={error}
            />
          ) : (
            <div
              key={tier.id}
              className="rounded-xl border border-line-dark bg-canvas p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-on-dark">{tier.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        statusStyles[tier.status] ?? statusStyles.active
                      }`}
                    >
                      {statusLabels[tier.status] ?? tier.status}
                    </span>
                  </div>
                  {tier.description && (
                    <p className="mb-2 text-sm text-on-dark-2">{tier.description}</p>
                  )}
                  <p className="text-sm text-on-dark-2">
                    <span className="font-semibold text-gold">
                      {naira(tier.price)}
                    </span>
                    {" · "}
                    <span className="tabular-nums">
                      {tier.quantitySold} of {tier.quantityTotal} sold
                    </span>
                    {" · "}
                    max {tier.maxPerOrder} per order
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(tier.id);
                      setAdding(false);
                      setError(null);
                    }}
                    title="Edit"
                    className="rounded-lg p-2 text-on-dark-2 transition-colors hover:bg-surface-2 hover:text-on-dark"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => toggleStatus(tier)}
                    disabled={busy}
                    title={tier.status === "paused" ? "Resume sales" : "Pause sales"}
                    className="rounded-lg p-2 text-on-dark-2 transition-colors hover:bg-surface-2 hover:text-on-dark disabled:opacity-50"
                  >
                    {tier.status === "paused" ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                  </button>
                  {tier.quantitySold === 0 && (
                    <button
                      onClick={() => setConfirmDeleteId(tier.id)}
                      title="Delete"
                      className="rounded-lg p-2 text-on-dark-2 transition-colors hover:bg-error/15 hover:text-error"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {confirmDeleteId === tier.id && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-error/40 bg-error/10 px-4 py-3">
                  <p className="text-sm text-on-dark">
                    Delete <strong>{tier.name}</strong>? This can&apos;t be undone.
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => remove(tier.id)}
                      disabled={busy}
                      className="rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {busy ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg p-1.5 text-on-dark-2 transition-colors hover:text-on-dark"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {error && !adding && editingId === null && (
          <p className="text-sm text-error">{error}</p>
        )}
      </div>
    </section>
  );
}
