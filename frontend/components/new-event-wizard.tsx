"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { AfterPurchaseFields } from "@/components/after-purchase-fields";
import { CoverImageField } from "@/components/cover-image-field";
import { EventBrandingFields } from "@/components/event-branding-fields";
import { PromoCodesEditor } from "@/components/promo-codes-editor";
import { RegistrationFieldsEditor } from "@/components/registration-fields-editor";
import { TicketTiers, type Tier } from "@/components/ticket-tiers";
import {
  quoteOrder,
  naira,
  PLATFORM_FEE_RATE,
  REFUND_RETAINED_RATE,
  type FeeStrategy,
  type FeeBearer,
} from "@/lib/fees";

/**
 * Event creation as a progression rather than a scattering.
 *
 * The old flow created a draft and dropped the organizer on a dashboard,
 * leaving tiers, pricing and publishing as separate errands they had to know
 * to run. Worse, publishing worked with no ticket types at all, so a student
 * could reach a live event page with nothing to buy.
 *
 * The draft is still created at the end of step one — tiers need an event to
 * hang off — but nothing goes public until step three, and the publish call
 * now refuses an event with no tickets.
 */

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string; hint: string }[] = [
  { n: 1, label: "Details", hint: "What, where and when" },
  { n: 2, label: "Tickets", hint: "Tiers and prices" },
  { n: 3, label: "Fees & publish", hint: "Who pays what" },
];

type Details = {
  title: string;
  description: string;
  category: string;
  coverImage: string | null;
  city: string;
  venueName: string;
  startDatetime: string;
  endDatetime: string;
  /** See the schema: the dates are still stored, just not shown to anyone. */
  dateTbd: boolean;
  venueTbd: boolean;
};

const EMPTY: Details = {
  title: "",
  description: "",
  category: "",
  coverImage: null,
  city: "",
  venueName: "",
  startDatetime: "",
  endDatetime: "",
  dateTbd: false,
  venueTbd: false,
};

const field =
  "w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-purple";
const label = "mb-1 block text-sm font-medium text-on-dark-2";

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function NewEventWizard() {
  const router = useRouter();
  const params = useSearchParams();

  // Step and draft id live in the URL so a refresh, or the browser back
  // button, lands the organizer where they were instead of starting over.
  const eventId = params.get("event");
  const urlStep = Number(params.get("step"));
  const [step, setStep] = useState<Step>(
    urlStep === 2 || urlStep === 3 ? (urlStep as Step) : 1
  );

  const [details, setDetails] = useState<Details>(EMPTY);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [feeStrategy, setFeeStrategy] = useState<FeeStrategy>("buyer_pays");
  const [platformFeePaidBy, setPlatformFeePaidBy] = useState<FeeBearer>("organizer");
  const [agreed, setAgreed] = useState(false);

  const [hydrating, setHydrating] = useState(Boolean(eventId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Details>(k: K, v: Details[K]) =>
    setDetails((d) => ({ ...d, [k]: v }));

  const goTo = useCallback(
    (next: Step, id = eventId) => {
      setStep(next);
      setError(null);
      const qs = id ? `?event=${id}&step=${next}` : "";
      router.replace(`/dashboard/events/new${qs}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [eventId, router]
  );

  const loadTiers = useCallback(async (id: string) => {
    const res = await fetch(`/api/events/${id}/ticket-types`);
    if (!res.ok) return;
    const data = await res.json();
    setTiers(Array.isArray(data) ? data : (data.ticketTypes ?? []));
  }, []);

  // Coming back to a draft (refresh, or a link) rebuilds the form from it.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error("That draft could not be loaded.");
        const raw = await res.json();
        const ev = raw.event ?? raw;
        if (cancelled) return;
        setDetails({
          title: ev.title ?? "",
          description: ev.description ?? "",
          category: ev.category ?? "",
          coverImage: ev.coverImage ?? null,
          city: ev.city ?? "",
          venueName: ev.venueName ?? "",
          startDatetime: toLocalInput(ev.startDatetime),
          endDatetime: toLocalInput(ev.endDatetime),
          dateTbd: ev.dateTbd ?? false,
          venueTbd: ev.venueTbd ?? false,
        });
        setFeeStrategy(ev.feeStrategy ?? "buyer_pays");
        setPlatformFeePaidBy(ev.platformFeePaidBy ?? "organizer");
        await loadTiers(eventId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load draft.");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, loadTiers]);

  // ── Step 1 ─────────────────────────────────────────────────────────────
  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (new Date(details.endDatetime) <= new Date(details.startDatetime)) {
      setError("The end time has to be after the start time.");
      return;
    }

    setBusy(true);
    const payload = {
      title: details.title.trim(),
      description: details.description.trim(),
      category: details.category.trim(),
      coverImage: details.coverImage ?? undefined,
      city: details.city.trim(),
      venueName: details.venueName.trim(),
      startDatetime: new Date(details.startDatetime).toISOString(),
      endDatetime: new Date(details.endDatetime).toISOString(),
      dateTbd: details.dateTbd,
      venueTbd: details.venueTbd,
    };

    const res = await fetch(
      eventId ? `/api/events/${eventId}` : "/api/events",
      {
        method: eventId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }

    const id = eventId ?? data.event?.id ?? data.id;
    if (!id) {
      setError("The event was saved but returned no id. Refresh and try again.");
      return;
    }
    if (eventId) await loadTiers(id);
    goTo(2, id);
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────
  async function publish() {
    if (!eventId) return;
    setBusy(true);
    setError(null);

    const saveFees = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeStrategy, platformFeePaidBy }),
    });
    if (!saveFees.ok) {
      const d = await saveFees.json().catch(() => ({}));
      setBusy(false);
      setError(d.error ?? "Could not save the fee setting.");
      return;
    }

    const res = await fetch(`/api/events/${eventId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Could not publish this event.");
      return;
    }
    router.push(`/dashboard/events/${eventId}`);
  }

  // Preview the real arithmetic on the organizer's own cheapest paid tier,
  // rather than an invented round number that hides the awkward cases.
  const paid = tiers.map((t) => Number(t.price)).filter((p) => p > 0);
  const samplePrice = paid.length ? Math.min(...paid) : 5000;
  const sampleIsReal = paid.length > 0;
  const quote = quoteOrder(samplePrice, {
    platformFeePaidBy,
    processingFeePaidBy: feeStrategy === "buyer_pays" ? "buyer" : "organizer",
  });
  const refundKeep = Math.round(REFUND_RETAINED_RATE * 100);

  if (hydrating) {
    return (
      <div className="flex items-center gap-3 text-on-dark-2">
        <Loader2 className="h-5 w-5 animate-spin text-purple" />
        Loading your draft…
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/events"
        className="text-sm text-on-dark-2 transition-colors hover:text-on-dark"
      >
        ← Back to events
      </Link>

      <h1 className="mb-6 mt-2 text-2xl font-bold text-on-dark">Create event</h1>

      {/* Progress */}
      <ol className="mb-8 flex items-stretch gap-2">
        {STEPS.map(({ n, label: name, hint }) => {
          const done = step > n;
          const current = step === n;
          return (
            <li key={n} className="flex-1">
              <button
                type="button"
                disabled={n > step || !eventId && n > 1}
                onClick={() => goTo(n)}
                className={`w-full border-t-2 pt-3 text-left transition-colors disabled:cursor-default ${
                  current
                    ? "border-purple"
                    : done
                      ? "border-purple/40"
                      : "border-line-dark"
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-sm font-semibold ${
                    current ? "text-on-dark" : done ? "text-on-dark-2" : "text-on-dark-3"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5 text-purple" /> : `${n}.`}
                  {name}
                </span>
                <span className="mt-0.5 hidden text-xs text-on-dark-3 sm:block">
                  {hint}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mb-4 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      {step === 1 && (
        <form
          onSubmit={saveDetails}
          className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6"
        >
          <CoverImageField
            value={details.coverImage}
            onChange={(url) => set("coverImage", url)}
            eventId={eventId ?? undefined}
            slugHint={details.title}
          />

          <div>
            <label className={label}>Event title</label>
            <input
              required
              value={details.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. UNICROSS Freshers Night"
              className={field}
            />
          </div>

          <div>
            <label className={label}>What should people know?</label>
            <textarea
              rows={4}
              value={details.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Who's performing, what's included, dress code, anything they'd ask you on WhatsApp."
              className={field}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Category</label>
              <input
                value={details.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="e.g. Parties"
                className={field}
              />
            </div>
            <div>
              <label className={label}>City</label>
              <input
                value={details.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="e.g. Calabar"
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>Venue</label>
            <input
              value={details.venueName}
              onChange={(e) => set("venueName", e.target.value)}
              placeholder="e.g. UNICROSS Main Auditorium"
              className={field}
              disabled={details.venueTbd}
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-on-dark-2">
              <input
                type="checkbox"
                checked={details.venueTbd}
                onChange={(e) => set("venueTbd", e.target.checked)}
                className="accent-[#6C3CFF]"
              />
              Venue not confirmed yet
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Starts</label>
              <input
                required
                type="datetime-local"
                value={details.startDatetime}
                onChange={(e) => set("startDatetime", e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className={label}>Ends</label>
              <input
                required
                type="datetime-local"
                value={details.endDatetime}
                onChange={(e) => set("endDatetime", e.target.value)}
                className={field}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-on-dark-2">
            <input
              type="checkbox"
              checked={details.dateTbd}
              onChange={(e) => set("dateTbd", e.target.checked)}
              className="mt-0.5 accent-[#6C3CFF]"
            />
            <span>
              Date not confirmed yet — show &ldquo;to be announced&rdquo;
              instead
            </span>
          </label>

          {(details.dateTbd || details.venueTbd) && (
            // The provisional date is not a formality: it decides which week
            // the event turns up in on the discovery rails, so an organiser
            // has to know their rough guess is doing real work.
            <p className="rounded-lg border border-purple/30 bg-purple/5 px-3 py-2 text-xs text-on-dark-2">
              Put your best guess in the fields above anyway — nobody sees it,
              but it decides where your event lands in{" "}
              <span className="text-on-dark">What&apos;s on</span>. Everyone
              holding a ticket is emailed automatically the moment you
              confirm.
            </p>
          )}

          <p className="text-xs text-on-dark-3">
            A city is needed before you can publish, and a venue unless
            you&apos;ve ticked that it isn&apos;t confirmed. You can come back
            to any of this.
          </p>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-purple py-3 font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save and add tickets"}
          </button>
        </form>
      )}

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      {step === 2 && eventId && (
        <div className="space-y-6">
          <TicketTiers
            eventId={eventId}
            tiers={tiers}
            onChange={() => void loadTiers(eventId)}
          />

          {tiers.length === 0 && (
            <p className="rounded-lg border border-line-dark bg-surface px-4 py-3 text-sm text-on-dark-2">
              Add at least one ticket type. A free event still needs one — set
              the price to 0 and people RSVP instead of paying.
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => goTo(1)}
              className="rounded-lg border border-line-dark px-5 py-3 font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
            >
              Back
            </button>
            <button
              type="button"
              disabled={tiers.length === 0}
              onClick={() => goTo(3)}
              className="flex-1 rounded-lg bg-purple py-3 font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-40"
            >
              Continue to fees
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ─────────────────────────────────────────────────────── */}
      {step === 3 && eventId && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <h2 className="font-bold text-on-dark">Fees</h2>
            <p className="mt-1 text-sm text-on-dark-2">
              Two charges sit on a ticket sale, and you decide who carries
              each. Whatever you pick, the buyer sees their full total on the
              event page — nothing is added at the payment screen.
            </p>

            <div className="mt-5 space-y-5">
              <FeeChoice
                title={`Wetin Dey's ${Math.round(PLATFORM_FEE_RATE * 100)}% service fee`}
                value={platformFeePaidBy}
                onChange={setPlatformFeePaidBy}
                organizerLabel="Comes out of my payout"
                buyerLabel="Add it to the buyer's total"
              />
              <FeeChoice
                title="Paystack's card charge"
                value={feeStrategy === "buyer_pays" ? "buyer" : "organizer"}
                onChange={(v) =>
                  setFeeStrategy(v === "buyer" ? "buyer_pays" : "organizer_absorbs")
                }
                organizerLabel="I'll cover it"
                buyerLabel="Add it to the buyer's total"
              />
            </div>

            {/* One live summary rather than four hypothetical ones — the
                organizer only needs to know what this combination does. */}
            <dl className="mt-6 space-y-1.5 border-t border-line-dark pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-on-dark-3">Ticket price</dt>
                <dd className="tabular-nums text-on-dark-2">{naira(quote.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-on-dark-3">
                  Buyer pays{" "}
                  {quote.platformFeePaidBy === "buyer" || quote.processingFeePaidBy === "buyer"
                    ? "(incl. fees they carry)"
                    : "(sticker price)"}
                </dt>
                <dd className="font-semibold tabular-nums text-on-dark">
                  {naira(quote.buyerTotal)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-on-dark-3">You receive per ticket</dt>
                <dd className="font-semibold tabular-nums text-purple-lift">
                  {naira(quote.organizerNet)}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-on-dark-3">
              {sampleIsReal
                ? `Based on your ${naira(samplePrice)} ticket.`
                : `Example on a ${naira(samplePrice)} ticket — your tiers are free, so no fees apply.`}
              {" "}If you refund a ticket, we keep {refundKeep}% instead of the
              full {Math.round(PLATFORM_FEE_RATE * 100)}%
              {platformFeePaidBy === "buyer"
                ? ", and the rest goes back to the buyer with the ticket price."
                : ", so a refunded sale costs you half as much."}
            </p>
          </div>

          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <RegistrationFieldsEditor eventId={eventId} />
          </div>

          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <AfterPurchaseFields eventId={eventId} />
          </div>

          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <EventBrandingFields eventId={eventId} />
          </div>

          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <PromoCodesEditor eventId={eventId} />
          </div>

          <div className="rounded-2xl border border-line-dark bg-surface p-6">
            <h2 className="font-bold text-on-dark">Before it goes live</h2>
            <ul className="mt-3 space-y-2 text-sm text-on-dark-2">
              <li>
                <span className="text-on-dark">{details.title || "Untitled"}</span>
                {details.venueName ? ` · ${details.venueName}` : ""}
                {details.city ? `, ${details.city}` : ""}
              </li>
              <li>
                {tiers.length} ticket {tiers.length === 1 ? "type" : "types"} ·{" "}
                {/* Seats, not rows. With a table tier these are different
                    numbers, and the one that has to fit in the hall is this
                    one. */}
                {tiers
                  .reduce(
                    (n, t) =>
                      n + Number(t.quantityTotal || 0) * Number(t.admits ?? 1),
                    0
                  )
                  .toLocaleString("en-NG")}{" "}
                {tiers.some((t) => Number(t.admits ?? 1) > 1)
                  ? "places available"
                  : "tickets available"}
              </li>
              <li>{details.coverImage ? "Cover art added" : "No cover art — it will show a placeholder"}</li>
            </ul>

            <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-on-dark-2">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 accent-[#6C3CFF]"
              />
              <span>
                I&apos;m allowed to run this event at this venue, the details
                above are accurate, and I&apos;ll handle refunds for anyone who
                asks before the doors open.
              </span>
            </label>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => goTo(2)}
              className="rounded-lg border border-line-dark px-5 py-3 font-semibold text-on-dark-2 transition-colors hover:text-on-dark"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || !agreed}
              onClick={publish}
              className="flex-1 rounded-lg bg-purple py-3 font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-40"
            >
              {busy ? "Publishing…" : "Publish event"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A two-option fee choice: who carries this particular charge. */
function FeeChoice({
  title,
  value,
  onChange,
  organizerLabel,
  buyerLabel,
}: {
  title: string;
  value: FeeBearer;
  onChange: (v: FeeBearer) => void;
  organizerLabel: string;
  buyerLabel: string;
}) {
  const options: { v: FeeBearer; label: string }[] = [
    { v: "organizer", label: organizerLabel },
    { v: "buyer", label: buyerLabel },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-on-dark">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ v, label: text }) => {
          const selected = value === v;
          return (
            <label
              key={v}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${
                selected
                  ? "border-purple bg-purple-dim text-on-dark"
                  : "border-line-dark text-on-dark-2 hover:border-on-dark-3"
              }`}
            >
              <input
                type="radio"
                checked={selected}
                onChange={() => onChange(v)}
                className="mt-0.5 accent-[#6C3CFF]"
              />
              <span>{text}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
