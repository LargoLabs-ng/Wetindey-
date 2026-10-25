-- Paystack is the provider for new transactions. Historical Monnify payment
-- rows keep their provider value and remain verifiable/refundable.
ALTER TABLE "payments"
  ALTER COLUMN "provider" SET DEFAULT 'paystack';

ALTER TABLE "events"
  ALTER COLUMN "fee_strategy" SET DEFAULT 'buyer_pays';

-- Freeze the platform-fee bearer on each order so future event setting
-- changes cannot rewrite historic organiser balances.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "platform_fee_paid_by" "fee_bearer"
  NOT NULL DEFAULT 'organizer';

UPDATE "orders" AS order_row
SET "platform_fee_paid_by" = event_row."platform_fee_paid_by"
FROM "events" AS event_row
WHERE order_row."event_id" = event_row."id";

ALTER TABLE "events"
  ALTER COLUMN "platform_fee_paid_by" SET DEFAULT 'organizer';
