-- Organizers can now pass the platform fee to the buyer as well, so who
-- carries it becomes a per-event choice like the card fee already is.
--
-- events.fee_strategy keeps its existing meaning: who carries PAYSTACK's
-- processing charge. This new column is only about our own cut.
DO $$ BEGIN
  CREATE TYPE fee_bearer AS ENUM ('organizer', 'buyer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS platform_fee_paid_by fee_bearer NOT NULL DEFAULT 'organizer';
