-- Audit trail for money leaving the system. Adds one table only.
CREATE TABLE IF NOT EXISTS "refunds" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id"          uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  "order_id"           uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "event_id"           uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "amount"             numeric(12,2) NOT NULL,
  "currency"           varchar(3) DEFAULT 'NGN' NOT NULL,
  "reason"             text,
  "provider_reference" varchar(150),
  "provider_response"  jsonb,
  "refunded_by"        uuid REFERENCES "users"("id"),
  "created_at"         timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "refunds_event_idx" ON "refunds" ("event_id");
