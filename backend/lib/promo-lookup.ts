import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes, promoCodeTicketTypes } from "@/db/schema";
import type { PromoCode } from "./promo";

/**
 * Read the code a buyer typed, with its ticket-type limit.
 *
 * Used by both the order route (which decides the price) and the preview
 * route (which only tells the buyer), so the two can never disagree about
 * what a code is. `normalizedCode` comes from normalizeCode(): trimmed and
 * upper case, matched case-insensitively against the stored code.
 *
 * Returns null for a code that doesn't exist on this event. Whether it may
 * be USED is checkCode()'s job, not this function's.
 */
export async function loadPromoCode(
  eventId: string,
  normalizedCode: string
): Promise<PromoCode | null> {
  const [row] = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.eventId, eventId),
        // Case-insensitive, matching the unique index in 0011.
        sql`upper(${promoCodes.code}) = ${normalizedCode}`
      )
    )
    .limit(1);

  if (!row) return null;

  const ticketTypeIds = row.appliesToAllTiers
    ? []
    : (
        await db
          .select({ id: promoCodeTicketTypes.ticketTypeId })
          .from(promoCodeTicketTypes)
          .where(eq(promoCodeTicketTypes.promoCodeId, row.id))
      ).map((r) => r.id);

  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    label: row.label,
    promoterName: row.promoterName,
    rate: Number(row.rate),
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    active: row.active,
    appliesToAllTiers: row.appliesToAllTiers,
    ticketTypeIds,
  };
}
