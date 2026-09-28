-- 0011 — the organiser toolkit.
--
-- Everything here is additive: new columns with defaults, two dropped NOT NULL
-- constraints, three new tables. Nothing is deleted and no existing row
-- changes meaning. Safe to re-run.
--
-- The shape comes from walking a competitor's create-event flow end to end.
-- The lesson was not any single feature — it was where the features live. Our
-- wizard asked for a title, some tiers and who pays the fees, and then went
-- live. Theirs asks all of that and then, on the same screen, asks the
-- questions an organiser actually has: what do I need from the people buying,
-- what do I tell them afterwards, whose logos go on this, when do sales open,
-- and who gets paid for bringing people.


-- ══ EVENTS ═══════════════════════════════════════════════════════════════

-- ── Branding ─────────────────────────────────────────────────────────────
-- The cover image is the flyer for THIS event. The logo is the organiser's
-- mark, and it belongs on every event they run, on the ticket and in the
-- email. Keeping them in one column would mean a committee re-uploading its
-- crest for every party it throws, and a ticket that carries a flyer where a
-- brand should be.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "logo_url" text;

-- [{ kind: 'image' | 'youtube', url: text }]
--
-- jsonb rather than a table: this is an ordered list that is always read whole
-- and written whole, never queried into. A gallery_items table would buy
-- referential integrity over strings nobody joins on, at the cost of a second
-- round trip on every event page load.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "gallery" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- [{ name: text, logoUrl: text, url: text | null }]
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "sponsors" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── What buyers get told after they pay ──────────────────────────────────
-- Shown on the ticket page and in the confirmation email, never on the public
-- event page. This is the WhatsApp group link, the Zoom link, the "come in
-- through the back gate after 8" — the thing organisers currently send by DM
-- to everyone individually, which is also why people who buy at 2am don't get
-- it until morning.
--
-- Deliberately not public: a WhatsApp invite link on an open page is a
-- WhatsApp group full of people who did not buy a ticket.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "after_purchase_note" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "after_purchase_url" text;

-- ── Date and venue become optional ───────────────────────────────────────
-- An organiser who does not yet have the hall confirmed currently cannot post
-- at all, so they wait, and they announce on WhatsApp instead, and by the time
-- the venue is signed the event has already happened somewhere else.
--
-- Nullable start means "to be announced", not "never". The application still
-- refuses to PUBLISH without a date; it just stops refusing to let one be
-- written down. Everyone already holding a ticket is emailed when the date or
-- venue is filled in or changed — which is the part that makes this safe to
-- offer at all.
ALTER TABLE "events" ALTER COLUMN "start_datetime" DROP NOT NULL;
ALTER TABLE "events" ALTER COLUMN "end_datetime" DROP NOT NULL;


-- ══ TICKET TYPES ═════════════════════════════════════════════════════════

-- ── Group tickets ────────────────────────────────────────────────────────
-- One ticket, more than one person through the door: a table of six, a couple's
-- entry, a hostel block buying together.
--
-- `admits` rather than an is_group flag plus a size, because a flag that can
-- disagree with the number beside it eventually will. admits = 1 is an
-- ordinary ticket and that is the default, so every existing row is already
-- correct.
--
-- Note for whoever touches capacity next: quantity_total counts TICKETS, not
-- people. With admits = 6 a quantity_total of 20 is twenty tables and one
-- hundred and twenty seats. Check-in has to let six people in on one scan.
ALTER TABLE "ticket_types"
  ADD COLUMN IF NOT EXISTS "admits" integer NOT NULL DEFAULT 1;

-- ── Flash discount ───────────────────────────────────────────────────────
-- Not an early-bird tier. An early-bird is a decision made weeks ahead; this
-- is the lever you pull on Thursday when Saturday is half sold. It starts when
-- the organiser presses the button and expires by itself.
--
-- The window is stored as two timestamps rather than "started_at + N hours"
-- so that every query is a plain BETWEEN, and so that ending one early is an
-- UPDATE of flash_ends_at to now() rather than arithmetic in three places.
--
-- flash_kind: 'percent' | 'amount'. No enum: this one is read by the pricing
-- code and nothing else, and an enum would make adding 'buy_one_get_one' a
-- migration instead of a branch.
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "flash_kind" varchar(10);
ALTER TABLE "ticket_types"
  ADD COLUMN IF NOT EXISTS "flash_value" numeric(12, 2);
ALTER TABLE "ticket_types"
  ADD COLUMN IF NOT EXISTS "flash_starts_at" timestamp;
ALTER TABLE "ticket_types" ADD COLUMN IF NOT EXISTS "flash_ends_at" timestamp;


-- ══ REGISTRATION FIELDS ══════════════════════════════════════════════════
--
-- The extra questions on the checkout form, on top of name and email.
--
-- This is the one feature on this list that is more valuable to us than to the
-- platform it was copied from. A general ticketing site offers custom fields
-- and gets "shirt size". We already know which university an event belongs to,
-- so an organiser asking for a matric number is asking the one question that
-- proves the room is full of students — and that is the whole premise of the
-- product.

DO $$ BEGIN
  CREATE TYPE "registration_field_kind" AS ENUM (
    'short_text',
    'paragraph',
    'choice',
    'checkboxes',
    'dropdown',
    'number',
    'phone',
    'date'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "registration_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "label" varchar(120) NOT NULL,
  "kind" "registration_field_kind" NOT NULL DEFAULT 'short_text',
  -- Only meaningful for choice / checkboxes / dropdown: ["Small","Medium"].
  "options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "required" boolean NOT NULL DEFAULT false,
  -- Explicit rather than relying on insertion order, because the organiser
  -- will drag these around and expect the checkout form to agree.
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "registration_fields_event_idx"
  ON "registration_fields" ("event_id", "position");

-- ── The answers ──────────────────────────────────────────────────────────
-- One row per question per order.
--
-- `label` is COPIED here rather than joined from the field. An organiser who
-- renames "Matric number" to "Student ID" halfway through selling must not
-- silently relabel four hundred answers that were given to the old question —
-- and deleting a question must not delete the answers people already gave.
-- Hence the snapshot, and hence ON DELETE SET NULL on field_id. Same reasoning
-- as the bank details copied onto a payout in 0010: this is a record of what
-- happened, not a view of what is currently configured.
CREATE TABLE IF NOT EXISTS "registration_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders" ("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "field_id" uuid REFERENCES "registration_fields" ("id") ON DELETE SET NULL,
  "label" varchar(120) NOT NULL,
  "value" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- The attendee table and its CSV export read "every answer for this event".
CREATE INDEX IF NOT EXISTS "registration_answers_event_idx"
  ON "registration_answers" ("event_id");
CREATE INDEX IF NOT EXISTS "registration_answers_order_idx"
  ON "registration_answers" ("order_id");


-- ══ PROMO CODES ══════════════════════════════════════════════════════════
--
-- Two things that look the same at checkout and are opposites in the ledger:
--
--   discount       — the buyer pays less. Costs the organiser money.
--   refer_to_earn  — the buyer pays the same; somebody is owed a cut for
--                    bringing them. Also costs the organiser money, later.
--
-- One table because they share everything that matters mechanically — a
-- string somebody types, a percentage, a usage limit, a count — and because an
-- organiser typing a code into the same box twice should not have to know
-- which of our tables it landed in.

DO $$ BEGIN
  CREATE TYPE "promo_code_kind" AS ENUM ('discount', 'refer_to_earn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" uuid NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "kind" "promo_code_kind" NOT NULL,
  "code" varchar(32) NOT NULL,
  -- What the organiser calls it in their own dashboard ("VIP promo").
  "label" varchar(120),
  -- refer_to_earn only: who is owed. A name, not an account — most people
  -- selling tickets for a campus party will never sign up for anything, and
  -- requiring them to is how a referral programme gets no referrers.
  "promoter_name" varchar(120),
  -- ...but when the promoter IS someone we invited to the team, this points at
  -- their staff row so /promote can show them their own numbers.
  "staff_id" uuid REFERENCES "event_staff" ("id") ON DELETE SET NULL,
  -- Percent, both kinds: % off for a discount, % commission for a referral.
  "rate" numeric(5, 2) NOT NULL DEFAULT 0,
  -- NULL means unlimited.
  "usage_limit" integer,
  "used_count" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Codes are matched case-insensitively — nobody types SUMMER20 the way you
-- wrote it down — so uniqueness has to be case-insensitive too, or the second
-- "summer20" on the same event becomes a coin flip at checkout.
CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_event_code_idx"
  ON "promo_codes" ("event_id", upper("code"));

-- ── Carrying over the codes that already exist ───────────────────────────
-- 0008 gave every promoter a ref_code on their staff row. Those links are in
-- circulation, so they are copied here rather than replaced: the same string
-- keeps working, now through one lookup instead of two.
--
-- rate 0 on purpose. Nobody was ever promised a percentage — attribution was
-- all that existed — and inventing a commission for them retroactively would
-- put money in a column that no organiser agreed to pay.
INSERT INTO "promo_codes"
  ("event_id", "kind", "code", "promoter_name", "staff_id", "rate")
SELECT s."event_id", 'refer_to_earn', s."ref_code", s."user_email", s."id", 0
FROM "event_staff" s
WHERE s."ref_code" IS NOT NULL
ON CONFLICT DO NOTHING;


-- ══ ORDERS ═══════════════════════════════════════════════════════════════

-- Which code was used, and what it took off. Both nullable: most orders use
-- neither.
--
-- discount_amount is stored rather than recomputed from the code, because the
-- code's rate can be edited afterwards and the amount a buyer was actually
-- charged cannot. An order is a receipt.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "promo_code_id" uuid
  REFERENCES "promo_codes" ("id") ON DELETE SET NULL;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "discount_amount" numeric(12, 2) NOT NULL DEFAULT 0;

-- "What did this code actually bring in" is the only question anybody asks of
-- a referral code, and it is asked every time a promoter is paid.
CREATE INDEX IF NOT EXISTS "orders_promo_code_idx"
  ON "orders" ("promo_code_id");
