-- Per-event staffing. Adds one table; touches nothing that already exists.
CREATE TABLE IF NOT EXISTS "event_staff" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id"     uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "user_id"      uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "user_email"   varchar(255) NOT NULL,
  "role"         "org_role" NOT NULL,
  "status"       varchar(50) DEFAULT 'pending' NOT NULL,
  "invite_token" varchar(255),
  "invited_at"   timestamp DEFAULT now(),
  "joined_at"    timestamp,
  "invited_by"   varchar(255),
  "created_at"   timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_staff_unique"
  ON "event_staff" ("event_id", "user_id");
