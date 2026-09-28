-- 0012 — "we haven't confirmed that yet".
--
-- Two boolean columns, both defaulting to false. Every existing event is
-- already correct: its date and venue are confirmed, because until now there
-- was no way to say otherwise.
--
-- ── Why a flag and not a null ───────────────────────────────────────────
--
-- 0011 dropped the NOT NULL from start_datetime, on the theory that "no date
-- yet" should be no date. That turned out to be the expensive answer: the
-- column is read in seventy-nine places, and every sort, countdown and
-- "what's on this week" rail would have had to decide what an undated event
-- means — all at once, in one change, across code that already worked.
--
-- So the date stays. An organiser posting early almost always has a rough
-- idea ("sometime in December"), and a provisional date sorts the event into
-- roughly the right week, which is exactly where somebody looking for it
-- would think to look. The flag says "don't show this number to anyone", and
-- the public page prints "to be announced" instead.
--
-- The honest cost, written down so nobody has to rediscover it: the
-- provisional date is real data that nobody is meant to see. Any query that
-- displays a date must check the flag first. The three places that matter —
-- the event page, the cards, and the change-notification email — do. The
-- email one is the subtle one: while date_tbd is true the notifier reports
-- the date as "not announced yet" whatever is stored, so moving a
-- provisional date around sends nobody an email about a date they were never
-- shown.
--
-- start_datetime is deliberately left nullable from 0011 rather than being
-- put back. Nothing writes null, and re-adding the constraint would fail on
-- any row that somehow already had one.

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "date_tbd" boolean NOT NULL DEFAULT false;

-- Separate from venue_name being empty. A blank venue is ambiguous — it
-- might mean "not decided" and it might mean "I'll come back to this" — and
-- publishing rules have to tell those apart: an event can go live with a
-- venue that is openly to be announced, but not with one the organiser
-- simply forgot.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "venue_tbd" boolean NOT NULL DEFAULT false;
