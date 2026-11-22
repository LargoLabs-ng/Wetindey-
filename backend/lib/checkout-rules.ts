import { availableQuantity } from "@/lib/availability";
import { formatDeadline, isValidTimeZone } from "@/lib/early-bird";

/**
 * "Can this ticket be sold right now, and if not, why not?" — in one place.
 *
 * The event page already greys out paused and sold-out tiers, but greying a
 * button out is a courtesy, not a rule: anything that can post to
 * /api/orders could buy a ticket the page refused to offer. This is the
 * rule, and the order route asks it before anything is held or written.
 *
 * Pure on purpose (no database), so every branch is unit-tested. The final
 * stock check still happens in the database, atomically, when seats are
 * held — this only decides whether it's worth trying.
 */

export type SaleCheckEvent = {
  status: string;
  archivedAt: Date | string | null;
  endDatetime: Date | string;
  /** The stored dates are placeholders while this is on. */
  dateTbd: boolean;
  timeZone: string;
};

export type SaleCheckTier = {
  status: string;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  salesStart: Date | string | null;
  salesEnd: Date | string | null;
};

export type SaleBlockCode =
  | "event_unavailable"
  | "event_ended"
  | "tier_paused"
  | "tier_sold_out"
  | "sales_not_started"
  | "sales_ended"
  | "not_enough";

/**
 * `available` is for the server's own use (logs, decisions). It must never
 * be sent to a visitor: stock numbers are organiser-only.
 */
export type SaleCheck =
  | { ok: true; available: number }
  | { ok: false; code: SaleBlockCode; message: string; available: number };

const FALLBACK_ZONE = "Africa/Lagos";

function time(value: Date | string | null): number | null {
  if (value === null) return null;
  const t = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(t) ? t : null;
}

export function checkTierSale(input: {
  event: SaleCheckEvent;
  tier: SaleCheckTier;
  quantity: number;
  now: Date;
}): SaleCheck {
  const { event, tier, quantity, now } = input;
  const nowMs = now.getTime();
  const zone = isValidTimeZone(event.timeZone) ? event.timeZone : FALLBACK_ZONE;
  const available = availableQuantity(tier);

  const block = (code: SaleBlockCode, message: string): SaleCheck => ({
    ok: false,
    code,
    message,
    available,
  });

  if (event.status !== "published" || event.archivedAt) {
    return block(
      "event_unavailable",
      "This event isn't selling tickets right now."
    );
  }

  // A provisional date is a placeholder, not a fact. If it drifted into the
  // past it must not stop sales for an event that hasn't been scheduled yet.
  const end = time(event.endDatetime);
  if (!event.dateTbd && end !== null && end <= nowMs) {
    return block(
      "event_ended",
      "This event has already ended, so tickets are no longer on sale."
    );
  }

  if (tier.status === "paused") {
    return block(
      "tier_paused",
      "This ticket isn't on sale right now. Please pick another one."
    );
  }

  const salesStart = time(tier.salesStart);
  if (salesStart !== null && nowMs < salesStart) {
    return block(
      "sales_not_started",
      `Sales for this ticket open on ${formatDeadline(new Date(salesStart), zone)}.`
    );
  }

  const salesEnd = time(tier.salesEnd);
  if (salesEnd !== null && nowMs >= salesEnd) {
    return block(
      "sales_ended",
      `Sales for this ticket closed on ${formatDeadline(new Date(salesEnd), zone)}.`
    );
  }

  if (tier.status === "sold_out" || available <= 0) {
    return block(
      "tier_sold_out",
      "This ticket is sold out. Please pick another one."
    );
  }

  if (available < quantity) {
    // No number: how many are left is for organisers only.
    return block(
      "not_enough",
      "There aren't enough tickets left for that many. Please choose fewer, or another ticket."
    );
  }

  return { ok: true, available };
}
