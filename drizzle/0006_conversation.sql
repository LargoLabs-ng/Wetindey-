-- 0006 — campus link on events, plus conversation, updates and moderation.
--
-- Additive only: two nullable columns and three new tables. Nothing is
-- dropped, no type changes, no backfill required. Safe to run against a
-- database with live events in it.

-- ── Campus link ─────────────────────────────────────────────────────────
-- Nullable and staying that way. An event with no university is a public
-- event, not a broken one, and every event that predates this column has
-- none. ON DELETE SET NULL so removing a campus record never deletes events.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "university_id" uuid REFERENCES "universities"("id") ON DELETE SET NULL;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "campus_id" uuid REFERENCES "campuses"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "events_university_idx" ON "events" ("university_id");
CREATE INDEX IF NOT EXISTS "events_campus_idx" ON "events" ("campus_id");

-- ── Enums ───────────────────────────────────────────────────────────────
-- DO blocks because CREATE TYPE has no IF NOT EXISTS, and this migration
-- has to be safe to re-run.
DO $$ BEGIN
  CREATE TYPE "message_status" AS ENUM ('visible', 'hidden', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "report_reason" AS ENUM ('spam', 'abuse', 'scam', 'off_topic', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "report_status" AS ENUM ('open', 'actioned', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Conversation ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "event_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- One level of replies. Self-referential, cascading so deleting a question
  -- takes its answers with it rather than orphaning them.
  "parent_id" uuid REFERENCES "event_messages"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "status" "message_status" NOT NULL DEFAULT 'visible',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_messages_event_idx"
  ON "event_messages" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "event_messages_parent_idx"
  ON "event_messages" ("parent_id");

-- ── Organiser updates ───────────────────────────────────────────────────
-- author_id is SET NULL rather than CASCADE: "the venue has moved" must
-- survive the departure of the staff account that posted it.
CREATE TABLE IF NOT EXISTS "event_updates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_updates_event_idx"
  ON "event_updates" ("event_id", "created_at");

-- ── Moderation ──────────────────────────────────────────────────────────
-- Ships in the same migration as event_messages, deliberately. §11 of the
-- build document makes report/block controls a requirement of enabling
-- user-generated content, not a follow-up to it.
CREATE TABLE IF NOT EXISTS "message_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" uuid NOT NULL REFERENCES "event_messages"("id") ON DELETE CASCADE,
  "reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" "report_reason" NOT NULL,
  "note" text,
  "status" "report_status" NOT NULL DEFAULT 'open',
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- One report per person per message: without it, a few accounts can run up
-- a number that reads like a pile-on.
CREATE UNIQUE INDEX IF NOT EXISTS "message_report_unique"
  ON "message_reports" ("message_id", "reporter_id");
CREATE INDEX IF NOT EXISTS "message_reports_status_idx"
  ON "message_reports" ("status", "created_at");

-- ── Blocking ────────────────────────────────────────────────────────────
-- Hiding a message handles a bad post. This handles a person who keeps
-- making them — without it, "block" in §11 is a word rather than a control.
-- Scoped to one event: an organiser polices their own thread, not the
-- platform.
CREATE TABLE IF NOT EXISTS "event_bans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_ban_unique"
  ON "event_bans" ("event_id", "user_id");
