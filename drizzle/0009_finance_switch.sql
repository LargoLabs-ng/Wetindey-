-- 0009 — the money switch.
--
-- One nullable-with-default column. Nothing is dropped, no enum changes, no
-- data migration.
--
-- Background: there were six roles, each a guess at which bundle of
-- permissions someone wants. What an organiser is actually deciding is two
-- separate things — how much can this person CHANGE, and can they see the
-- MONEY — so the second one becomes its own switch and the role list drops
-- to four assignable ones.
--
-- Deliberately NOT changing existing rows:
--
--   * `event_manager` is relabelled "Editor" in the UI. It already had no
--     finance access after 0008's permission change, so the flag defaulting
--     to false leaves every existing holder exactly where they were.
--   * `finance` is retired from the invite list but kept in the enum and in
--     the permission matrix. Anyone already holding it keeps the access they
--     have — nobody loses the ability to do their job because the model
--     changed underneath them.
--
-- False by default on purpose: the safe answer to "should this person see
-- the payout account" is no, until somebody deliberately says otherwise.

ALTER TABLE "event_staff"
  ADD COLUMN IF NOT EXISTS "can_see_finances" boolean NOT NULL DEFAULT false;
