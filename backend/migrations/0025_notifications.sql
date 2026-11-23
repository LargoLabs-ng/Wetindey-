-- 0025 — the notification system's tables.
--
-- Additive only: eight new tables, nothing existing is changed or dropped,
-- and today's code never reads them. Safe to apply before the code that uses
-- it is deployed, and safe to run twice (every statement is IF NOT EXISTS /
-- ON CONFLICT DO NOTHING).
--
-- How the pieces fit:
--   notification_events            the outbox: one row per thing that
--                                  happened, written in the same transaction
--                                  as the business change itself.
--   notifications                  the in-app inbox: one row per person per
--                                  thing.
--   notification_deliveries        one row per person x thing x channel x
--                                  destination (an email address, or one
--                                  push device), each with its own retries.
--   notification_delivery_attempts every send attempt, kept for 90 days.
--   notification_preferences       only the switches someone changed from
--                                  the default; defaults live in code.
--   push_subscriptions             browser push devices, many per person
--                                  (used from Phase 4).
--   discovery_items                events that became discoverable, bundled
--                                  into daily/weekly summaries (Phase 3).
--   notification_settings          small key/value settings; holds the time
--                                  this migration ran, so the reconciliation
--                                  sweep never notifies about older orders.
--
-- The attempt rule is the same everywhere: max_attempts = 5 is the TOTAL,
-- including the first try. A CHECK makes a sixth attempt impossible.

CREATE TABLE IF NOT EXISTS "notification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" varchar(80) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" varchar(300) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "available_at" timestamp NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(),
  "locked_until" timestamp,
  "claimed_by" varchar(64),
  "fanout_cursor" varchar(200),
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp,
  CONSTRAINT "notification_events_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "notification_events_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "notification_events_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS "notification_events_due_idx"
  ON "notification_events" ("status", "available_at", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL CONSTRAINT "notifications_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE CASCADE,
  "event_id" uuid CONSTRAINT "notifications_event_id_notification_events_id_fk" REFERENCES "notification_events"("id") ON DELETE SET NULL,
  "type" varchar(80) NOT NULL,
  "category" varchar(40) NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text,
  "url" varchar(500),
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" varchar(400) NOT NULL,
  "read_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_dedupe_key_unique" UNIQUE ("dedupe_key")
);
CREATE INDEX IF NOT EXISTS "notifications_user_inbox_idx"
  ON "notifications" ("user_id", "read_at", "created_at" DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL CONSTRAINT "push_subscriptions_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" varchar(200) NOT NULL,
  "auth" varchar(100) NOT NULL,
  "user_agent" varchar(300),
  "device_label" varchar(100),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_success_at" timestamp,
  "failure_count" integer NOT NULL DEFAULT 0,
  "revoked_at" timestamp,
  CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE ("endpoint")
);
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" ("user_id");

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid CONSTRAINT "notification_deliveries_event_id_notification_events_id_fk" REFERENCES "notification_events"("id") ON DELETE SET NULL,
  "notification_id" uuid CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" REFERENCES "notifications"("id") ON DELETE SET NULL,
  "user_id" uuid CONSTRAINT "notification_deliveries_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE CASCADE,
  "email" varchar(255),
  "channel" varchar(20) NOT NULL,
  "push_subscription_id" uuid CONSTRAINT "notification_deliveries_push_subscription_id_push_subscriptions" REFERENCES "push_subscriptions"("id") ON DELETE CASCADE,
  "category" varchar(40) NOT NULL,
  "essential" boolean NOT NULL DEFAULT false,
  "content" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" varchar(400) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(),
  "locked_until" timestamp,
  "claimed_by" varchar(64),
  "last_error" text,
  "provider_message_id" varchar(200),
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "notification_deliveries_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" IN ('email', 'push'))
);
CREATE INDEX IF NOT EXISTS "notification_deliveries_due_idx"
  ON "notification_deliveries" ("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "notification_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "delivery_id" uuid NOT NULL CONSTRAINT "notification_delivery_attempts_delivery_id_notification_deliver" REFERENCES "notification_deliveries"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  "outcome" varchar(30),
  "provider_status" varchar(40),
  "error" text,
  "provider_message_id" varchar(200),
  CONSTRAINT "notification_delivery_attempts_number_check" CHECK ("attempt_number" BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_delivery_idx"
  ON "notification_delivery_attempts" ("delivery_id");

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid NOT NULL CONSTRAINT "notification_preferences_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE CASCADE,
  "category" varchar(40) NOT NULL,
  "channel" varchar(20) NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_user_id_category_channel_pk" PRIMARY KEY ("user_id", "category", "channel")
);

CREATE TABLE IF NOT EXISTS "discovery_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL CONSTRAINT "discovery_items_event_id_events_id_fk" REFERENCES "events"("id") ON DELETE CASCADE,
  "university_id" uuid CONSTRAINT "discovery_items_university_id_universities_id_fk" REFERENCES "universities"("id") ON DELETE SET NULL,
  "campus_id" uuid CONSTRAINT "discovery_items_campus_id_campuses_id_fk" REFERENCES "campuses"("id") ON DELETE SET NULL,
  "city" varchar(100),
  "category" varchar(100),
  "listed_at" timestamp NOT NULL DEFAULT now(),
  "bundled_at" timestamp,
  CONSTRAINT "discovery_items_event_unique" UNIQUE ("event_id")
);
CREATE INDEX IF NOT EXISTS "discovery_items_unbundled_idx"
  ON "discovery_items" ("bundled_at", "university_id");

CREATE TABLE IF NOT EXISTS "notification_settings" (
  "key" varchar(60) PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- When notifications went live on this database. The reconciliation sweep
-- only looks at business records newer than this, so nobody is notified
-- about an order from before the system existed. Never overwritten.
INSERT INTO "notification_settings" ("key", "value")
VALUES ('sweep_since', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT ("key") DO NOTHING;
