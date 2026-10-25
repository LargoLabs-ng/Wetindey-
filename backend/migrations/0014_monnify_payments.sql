-- Monnify is the provider for newly-created payments. Historical provider
-- values remain unchanged so old Paystack callbacks and refunds can complete.
ALTER TABLE "payments"
  ALTER COLUMN "provider" SET DEFAULT 'monnify';

ALTER TABLE "events"
  ALTER COLUMN "fee_strategy" SET DEFAULT 'organizer_absorbs';

DO $$ BEGIN
  CREATE TYPE "refund_status" AS ENUM ('pending', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Existing refund rows were written only after the provider accepted them.
ALTER TABLE "refunds"
  ADD COLUMN IF NOT EXISTS "status" "refund_status" NOT NULL DEFAULT 'completed';

CREATE INDEX IF NOT EXISTS "refunds_provider_reference_idx"
  ON "refunds" ("provider_reference")
  WHERE "provider_reference" IS NOT NULL;
