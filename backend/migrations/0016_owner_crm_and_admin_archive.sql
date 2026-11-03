ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "marketing_consent" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "crm_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" varchar(60) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_tags_organization_idx"
  ON "crm_tags" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_organization_name_idx"
  ON "crm_tags" ("organization_id", "name");

CREATE TABLE IF NOT EXISTS "crm_contact_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tag_id" uuid NOT NULL REFERENCES "crm_tags"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "crm_contact_tags_email_idx"
  ON "crm_contact_tags" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contact_tags_tag_email_idx"
  ON "crm_contact_tags" ("tag_id", "email");

CREATE TABLE IF NOT EXISTS "crm_contact_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "marketing_opt_out_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contact_preferences_org_email_idx"
  ON "crm_contact_preferences" ("organization_id", "email");
