-- 0010 — bank details and withdrawal requests.
--
-- Additive: six nullable columns and two with defaults. Nothing dropped.
--
-- This closes the gap that mattered most: the product collected real money
-- and had no way to give it back to the organiser. There was a payouts table
-- and a per-event calculation, and nowhere to put a bank account.

-- ── Where the money goes ────────────────────────────────────────────────
-- On the organisation, not the user: a committee that changes treasurer
-- should not lose its payout details along with the person.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "bank_name" varchar(120);
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(200);
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(20);

-- ── The request itself ──────────────────────────────────────────────────
-- The bank details are COPIED onto each payout rather than joined from the
-- organisation. An organiser who changes account after requesting a payout
-- must not have the record of the old request silently rewritten to point at
-- the new one — this is the row somebody reads when a transfer goes astray.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "bank_name" varchar(120);
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(200);
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(20);

ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;

-- Defaults to now() so rows that predate this column get a plausible time
-- rather than a null that every sort has to special-case.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "requested_at" timestamp NOT NULL DEFAULT now();

-- Why a request was refused, shown back to the organiser. A payout that
-- silently fails to arrive is how trust in a platform ends.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "note" text;

-- The withdrawal page reads "everything this organisation requested, newest
-- first" on every load.
CREATE INDEX IF NOT EXISTS "payouts_org_requested_idx"
  ON "payouts" ("organization_id", "requested_at" DESC);
