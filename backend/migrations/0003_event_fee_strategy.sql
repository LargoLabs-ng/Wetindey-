-- Who carries Paystack's processing fee, decided per event rather than per
-- organization: a free freshers' night and a paid conference run by the same
-- association can reasonably answer this differently.
--
-- The fee_strategy enum already exists (organizations.fee_strategy declares
-- it), so this only adds the column. Existing events keep today's behaviour.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS fee_strategy fee_strategy NOT NULL DEFAULT 'buyer_pays';
