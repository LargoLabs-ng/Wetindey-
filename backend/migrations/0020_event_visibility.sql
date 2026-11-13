-- 0020: event visibility, separate from publication status.
--
-- `status` answers "is this live?" — the page loads, tickets sell, the
-- conversation is open, change emails go out.
-- `visibility` answers "is this LISTED?" — discovery, the homepage rails,
-- the public events API, and whether search engines may index the page.
--
-- An unlisted event is still `published`. It is left out of public listings
-- and its page carries noindex; anyone with the link can still open it and
-- buy a ticket. Kept separate from event_status on purpose: adding
-- 'unlisted' there would break every `status = 'published'` check, checkout
-- included.
--
-- Every existing row becomes 'public', which is exactly how it behaves today.
-- Adding a column with a constant default is a metadata-only change in
-- Postgres 11+, so no table rewrite.
--
-- Safe to run twice.
DO $$ BEGIN
  CREATE TYPE "event_visibility" AS ENUM ('public', 'unlisted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "visibility" "event_visibility" NOT NULL DEFAULT 'public';
