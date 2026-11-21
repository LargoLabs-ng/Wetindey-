-- 0022 — when the payment provider actually paid the money to Wetin Dey.
--
-- Additive: two nullable columns and one index. Nothing dropped, no data
-- changed. Every existing payment starts as "not settled yet" (NULL), which
-- is the honest answer until the settlement sync has checked it.
--
-- Background: a `charge.success` webhook means the BUYER paid Paystack. It
-- does not mean Paystack has paid Wetin Dey. Paystack pays out in batches
-- ("settlements"), and there is no webhook for that, so the sync asks the
-- Settlements API which transactions each successful settlement contained
-- and stamps the matching payments here.
--
-- Only `backend/lib/paystack-settlements.ts` writes these columns, and only
-- for Paystack payments whose reference appears in a SUCCESSFUL settlement.
-- Legacy Monnify payments are deliberately left NULL: they are reported, not
-- assumed settled.

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "settled_at" timestamp;

-- Paystack's settlement id, kept as text: Paystack documents ids as large
-- integers, and text sidesteps any precision question.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "settlement_reference" varchar(64);

-- The balance query asks "which successful payments are settled", and the
-- sync asks "which Paystack payments are not settled yet".
CREATE INDEX IF NOT EXISTS "payments_provider_settled_idx"
  ON "payments" ("provider", "settled_at");
