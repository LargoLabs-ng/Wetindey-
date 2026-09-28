-- 0008 — two new roles, and per-promoter sale attribution.
--
-- Additive: two enum values, two nullable columns, one index. Nothing is
-- dropped and no existing row changes meaning.
--
-- Note that the Event Manager role's *permissions* changed in this release
-- too — it no longer carries finance:view or refund:issue — but that lives
-- entirely in lib/permissions.ts, not in the database. The role name in this
-- enum is just a label; what it can do is decided in code. Anyone already
-- holding it simply stops seeing payouts the moment the new code deploys.

-- ── The new roles ───────────────────────────────────────────────────────
-- ADD VALUE IF NOT EXISTS so this is safe to re-run. Postgres will not let
-- these run inside an explicit transaction block on older versions; the
-- apply script sends the file as plain statements, so that is fine here.
ALTER TYPE "org_role" ADD VALUE IF NOT EXISTS 'viewer';
ALTER TYPE "org_role" ADD VALUE IF NOT EXISTS 'promoter';

-- ── The promoter's share code ───────────────────────────────────────────
-- On the staff row, not the user: the same person promoting two events needs
-- two codes, or a sale can be attributed to a person but not to the event
-- they sold it for — which is the only question anyone actually asks.
ALTER TABLE "event_staff"
  ADD COLUMN IF NOT EXISTS "ref_code" varchar(24);

-- Codes are looked up on every visit to a shared link, so they need an index,
-- and two promoters on one event must never share one.
CREATE UNIQUE INDEX IF NOT EXISTS "event_staff_ref_code_unique"
  ON "event_staff" ("event_id", "ref_code")
  WHERE "ref_code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "event_staff_ref_code_idx"
  ON "event_staff" ("ref_code")
  WHERE "ref_code" IS NOT NULL;

-- ── Who sold it ─────────────────────────────────────────────────────────
-- Points at the user rather than the staff row, so attribution survives the
-- promoter being taken off the event later. ON DELETE SET NULL because a
-- deleted account must not take the order with it — the sale still happened,
-- it just stops naming anyone.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "promoter_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "orders_promoter_idx"
  ON "orders" ("event_id", "promoter_id")
  WHERE "promoter_id" IS NOT NULL;
