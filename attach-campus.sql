-- One-off: attach the existing account and events to their campus.
--
--   node apply-migration.mjs attach-campus.sql
--
-- Everything here predates the university_id column, so it all came out
-- null. Nothing below invents an affiliation — each statement matches on a
-- name that already says which university it belongs to, and anything that
-- doesn't match is left alone.
--
-- Safe to run twice: every statement is a conditional UPDATE.

-- ── The account ─────────────────────────────────────────────────────────
-- Matched by email rather than id so this file has no magic numbers in it.
-- Calabar because that is where both UNICROSS events are.
UPDATE "users" u
SET "university_id" = uni."id",
    "campus_id"     = c."id",
    "updated_at"    = now()
FROM "universities" uni
JOIN "campuses" c ON c."university_id" = uni."id" AND c."slug" = 'calabar'
WHERE uni."slug" = 'unicross'
  AND u."email" = 'kisha.of.web3@gmail.com'
  AND u."university_id" IS NULL;

-- ── The UNICROSS events ─────────────────────────────────────────────────
-- Only events whose title actually says UNICROSS. "tedx uniuyo" and
-- "Ticket Buddy Test Event" are at Uniuyo, which is not seeded, so they stay
-- null — which means public, and they keep showing to everybody. That is the
-- correct outcome, not a gap.
UPDATE "events" e
SET "university_id" = uni."id",
    "campus_id"     = c."id",
    "updated_at"    = now()
FROM "universities" uni
JOIN "campuses" c ON c."university_id" = uni."id" AND c."slug" = 'calabar'
WHERE uni."slug" = 'unicross'
  AND e."title" ILIKE 'UNICROSS%'
  AND e."university_id" IS NULL;

-- ── What happened ───────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM "users"  WHERE "university_id" IS NOT NULL) AS users_with_campus,
  (SELECT count(*) FROM "events" WHERE "university_id" IS NOT NULL) AS events_with_campus,
  (SELECT count(*) FROM "events" WHERE "university_id" IS NULL)     AS events_public;
