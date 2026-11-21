import type { ticketTypes } from "@/db/schema";

/**
 * What a visitor may know about a ticket tier.
 *
 * Stock numbers are the organiser's business. A visitor sees whether a tier
 * can be bought and, once it can't, "Sold out" — never how many are left,
 * how many were sold, or the tier's size. The event page's API used to hand
 * out the raw tier rows, which let anyone work out sales by subtraction, so
 * it now sends only this.
 *
 * An explicit allowlist rather than "everything minus the counts": a column
 * added to ticket_types later stays private until someone decides here that
 * the public should see it.
 */
export type PublicTier = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  maxPerOrder: number;
  /** People one ticket lets in. 1 is an ordinary ticket. */
  admits: number;
  /** "active" | "paused" | "sold_out", as organisers set or the system marks it. */
  status: string;
  earlyBirdEnabled: boolean;
  earlyBirdPrice: string | null;
  earlyBirdEndsAt: Date | null;
  salesStart: Date | null;
  salesEnd: Date | null;
  /** Nothing left to buy right now (sold, or held by checkouts in progress). */
  soldOut: boolean;
};

type TierRow = typeof ticketTypes.$inferSelect;

export function toPublicTier(tier: TierRow): PublicTier {
  // Same arithmetic as availableQuantity() in lib/inventory.ts, done here so
  // this file stays free of database imports and can be unit-tested.
  const left = Math.max(0, tier.quantityTotal - tier.quantitySold - tier.quantityReserved);

  return {
    id: tier.id,
    name: tier.name,
    description: tier.description,
    price: tier.price,
    currency: tier.currency,
    maxPerOrder: tier.maxPerOrder,
    admits: tier.admits,
    status: tier.status,
    earlyBirdEnabled: tier.earlyBirdEnabled,
    earlyBirdPrice: tier.earlyBirdPrice,
    earlyBirdEndsAt: tier.earlyBirdEndsAt,
    salesStart: tier.salesStart,
    salesEnd: tier.salesEnd,
    soldOut: tier.status === "sold_out" || left <= 0,
  };
}
