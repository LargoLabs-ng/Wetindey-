/**
 * The one order ticket types are shown in, everywhere: cheapest first, then
 * by name (ignoring capitals), then by id so two identical tiers never swap.
 *
 * Without an explicit order the database returns rows in whatever order is
 * convenient, which changes when a tier is edited, so tiers used to jump
 * around after a save, and the public page could pre-select a different
 * tier from one visit to the next.
 */
import { asc, sql, type AnyColumn } from "drizzle-orm";
import { ticketTypes } from "@/db/schema";

type TierColumns = { price: AnyColumn; name: AnyColumn; id: AnyColumn };

/** For `.orderBy(...)`, and for `with: { ticketTypes: { orderBy: ticketTypeOrder } }`. */
export function ticketTypeOrder(t: TierColumns = ticketTypes) {
  return [asc(t.price), asc(sql`lower(${t.name})`), asc(t.id)];
}

