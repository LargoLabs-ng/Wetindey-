-- 0021: limit a promo code to chosen ticket types.
--
-- applies_to_all_tiers = true (the default, and every existing code): the
-- code works on any ticket type, exactly as before this migration.
-- applies_to_all_tiers = false: the code works only on the ticket types
-- listed for it in promo_code_ticket_types.
--
-- The explicit switch matters. If "no rows" meant "all tiers", deleting the
-- only allowed tier (its rows go with it) would quietly turn a VIP-only code
-- into an everything code. With the switch, that code simply stops working
-- until the organiser picks a tier again.
--
-- Additive only: nothing existing is changed or removed. Safe to run twice.
ALTER TABLE "promo_codes"
  ADD COLUMN IF NOT EXISTS "applies_to_all_tiers" boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "promo_code_ticket_types" (
  "promo_code_id"  uuid NOT NULL REFERENCES "promo_codes"("id")  ON DELETE CASCADE,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE CASCADE,
  PRIMARY KEY ("promo_code_id", "ticket_type_id")
);

CREATE INDEX IF NOT EXISTS "promo_code_ticket_types_tier_idx"
  ON "promo_code_ticket_types" ("ticket_type_id");
