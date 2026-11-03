-- Early Bird is a price on an existing tier, not another tier or inventory pool.
-- Existing rows keep their regular price and default to disabled.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "time_zone" varchar(64) NOT NULL DEFAULT 'Africa/Lagos';

ALTER TABLE "ticket_types"
  ADD COLUMN IF NOT EXISTS "early_bird_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "early_bird_price" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "early_bird_ends_at" timestamp;

-- Null for orders created before this migration; no historical order is rewritten.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "ticket_unit_price" numeric(12, 2);

-- A verified stale-price payment is durable and cannot be mistaken for issued tickets.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "manual_review_required" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "manual_review_reason" text,
  ADD COLUMN IF NOT EXISTS "manual_review_resolved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "manual_review_note" text,
  ADD COLUMN IF NOT EXISTS "manual_review_resolved_by" uuid REFERENCES "users"("id");
