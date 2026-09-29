-- 0007 — remove the second, wrong source of truth for the platform fee.
--
-- READ THIS BEFORE RUNNING. Unlike 0006, this migration DROPS columns, and
-- that cannot be undone. Run it only once you are satisfied with the two
-- checks below.
--
-- Background: organizations.fee_percent / fee_flat / fee_strategy were added
-- so pricing could change without engineering. Nothing ever read them. Every
-- real calculation uses PLATFORM_FEE_RATE in lib/fees.ts, currently 5% —
-- while fee_percent has been sitting at a default of 8.00. Two numbers
-- claiming to be the platform fee, the more visible one wrong.
--
-- The danger is not today. It is the day someone finds fee_percent, assumes
-- it is live, and wires it up — at which point every organiser's cut changes
-- from 5% to 8% with no code review catching it, because the code looks like
-- it is doing the right thing.

-- ── Check 1: nothing in the codebase reads them ─────────────────────────
-- Verified by grep across src/ before writing this: the only references were
-- the column definitions themselves. Re-run it yourself if you want:
--   grep -rn "feePercent\|fee_flat\|feePercent" src/
--
-- ── Check 2: no organisation ever set a custom value ────────────────────
-- Run this SELECT on its own first. If it returns any rows, STOP — somebody
-- did configure per-organisation pricing at some point and those values are
-- about to be lost.
--
--   SELECT id, name, fee_percent, fee_flat, fee_strategy
--   FROM organizations
--   WHERE fee_percent <> 8.00 OR fee_flat <> 0.00 OR fee_strategy <> 'buyer_pays';
--
-- Expected: 0 rows, because nothing in the app has ever written to them.

ALTER TABLE "organizations" DROP COLUMN IF EXISTS "fee_percent";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "fee_flat";

-- Note: only the ORGANIZATIONS copy goes. events.fee_strategy is live and
-- load-bearing — it decides who carries Paystack's charge on each event —
-- and must not be touched.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "fee_strategy";
