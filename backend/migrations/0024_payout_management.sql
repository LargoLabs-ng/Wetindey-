-- 0024 — admin payout management: references, history, permissions.
--
-- Additive: three nullable columns, one table, two permission rows. Nothing
-- dropped, no existing row changed. Run AFTER 0023.

-- ── On each request ─────────────────────────────────────────────────────
-- The bank transfer reference recorded when an admin marks it paid. Unique:
-- one transfer cannot confirm two payouts.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "payment_reference" varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_payment_reference_unique"
  ON "payouts" ("payment_reference")
  WHERE "payment_reference" IS NOT NULL;

-- The settled balance the organiser had when they asked. Null on requests
-- made before this migration: that figure was never recorded and is not
-- invented after the fact.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "available_at_request" numeric(12, 2);

ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp;

-- ── The history ─────────────────────────────────────────────────────────
-- One row per thing that happened to a request: requested, approved,
-- processing, paid, failed, rejected. Only ever inserted, never edited —
-- this is the record somebody reads when money goes astray.
CREATE TABLE IF NOT EXISTS "payout_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payout_id" uuid NOT NULL REFERENCES "payouts"("id") ON DELETE CASCADE,
  "from_status" varchar(20),
  "to_status" varchar(20) NOT NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "payment_reference" varchar(120),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "payout_events_payout_idx"
  ON "payout_events" ("payout_id", "created_at");

-- ── Who may see and act ─────────────────────────────────────────────────
-- Super Admin only in v1. Finance Admin gets nothing yet: viewing can be
-- granted later with one row, approving deliberately needs its own decision.
-- (Only present if 0018 created the RBAC tables.)
DO $$
BEGIN
  IF to_regclass('public.platform_admin_permissions') IS NOT NULL THEN
    INSERT INTO "platform_admin_permissions" ("id", "description") VALUES
      ('payouts.view', 'View organiser payout requests and their bank details.'),
      ('payouts.manage', 'Approve, process, reject and confirm organiser payouts.')
    ON CONFLICT ("id") DO NOTHING;
    INSERT INTO "platform_admin_role_permissions" ("role_id", "permission_id") VALUES
      ('super_admin', 'payouts.view'),
      ('super_admin', 'payouts.manage')
    ON CONFLICT ("role_id", "permission_id") DO NOTHING;
  END IF;
END $$;
