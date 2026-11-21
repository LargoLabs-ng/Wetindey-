-- 0023 — two new payout statuses: approved and rejected.
--
-- In its own file because Postgres will not let a new enum value be USED in
-- the same transaction that adds it, and the migration runner sends a whole
-- file as one batch. Nothing here uses the values; 0024 and the code do.
--
-- Additive and safe to run twice. Existing rows keep their status.
--
--   pending → approved → processing → paid
--   pending / approved / failed → rejected   (reason required)
--   processing → failed → processing (retry)

ALTER TYPE "payout_status" ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE "payout_status" ADD VALUE IF NOT EXISTS 'rejected';
