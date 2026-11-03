CREATE TABLE IF NOT EXISTS "ticket_type_price_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_type_id" uuid NOT NULL REFERENCES "ticket_types"("id") ON DELETE CASCADE,
  "price" numeric(12, 2) NOT NULL,
  "early_bird_enabled" boolean NOT NULL,
  "early_bird_price" numeric(12, 2),
  "early_bird_ends_at" timestamp,
  "valid_from" timestamp NOT NULL,
  "valid_until" timestamp
);

CREATE INDEX IF NOT EXISTS "ticket_type_price_history_tier_start_idx"
  ON "ticket_type_price_history" ("ticket_type_id", "valid_from");

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_type_price_history_current_unique"
  ON "ticket_type_price_history" ("ticket_type_id")
  WHERE "valid_until" IS NULL;

CREATE OR REPLACE FUNCTION record_ticket_type_price_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_at timestamp := now();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "ticket_type_price_history" (
      "ticket_type_id",
      "price",
      "early_bird_enabled",
      "early_bird_price",
      "early_bird_ends_at",
      "valid_from"
    ) VALUES (
      NEW."id",
      NEW."price",
      NEW."early_bird_enabled",
      NEW."early_bird_price",
      NEW."early_bird_ends_at",
      changed_at
    );
    RETURN NEW;
  END IF;

  IF OLD."price" IS DISTINCT FROM NEW."price"
    OR OLD."early_bird_enabled" IS DISTINCT FROM NEW."early_bird_enabled"
    OR OLD."early_bird_price" IS DISTINCT FROM NEW."early_bird_price"
    OR OLD."early_bird_ends_at" IS DISTINCT FROM NEW."early_bird_ends_at"
  THEN
    UPDATE "ticket_type_price_history"
    SET "valid_until" = changed_at
    WHERE "ticket_type_id" = OLD."id"
      AND "valid_until" IS NULL;

    INSERT INTO "ticket_type_price_history" (
      "ticket_type_id",
      "price",
      "early_bird_enabled",
      "early_bird_price",
      "early_bird_ends_at",
      "valid_from"
    ) VALUES (
      NEW."id",
      NEW."price",
      NEW."early_bird_enabled",
      NEW."early_bird_price",
      NEW."early_bird_ends_at",
      changed_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ticket_type_price_history_trigger" ON "ticket_types";
CREATE TRIGGER "ticket_type_price_history_trigger"
  AFTER INSERT OR UPDATE ON "ticket_types"
  FOR EACH ROW
  EXECUTE FUNCTION record_ticket_type_price_history();

INSERT INTO "ticket_type_price_history" (
  "ticket_type_id",
  "price",
  "early_bird_enabled",
  "early_bird_price",
  "early_bird_ends_at",
  "valid_from"
)
SELECT
  t."id",
  t."price",
  t."early_bird_enabled",
  t."early_bird_price",
  t."early_bird_ends_at",
  now()
FROM "ticket_types" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "ticket_type_price_history" h
  WHERE h."ticket_type_id" = t."id"
    AND h."valid_until" IS NULL
)
ON CONFLICT DO NOTHING;
