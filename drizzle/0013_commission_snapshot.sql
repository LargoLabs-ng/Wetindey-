-- 0013 — what a promoter is owed, frozen at the moment of sale.
--
-- One column with a default. Nothing dropped.
--
-- 0011 stored `discount_amount` on the order rather than recomputing it from
-- the code, because the code's rate can be edited afterwards and what a buyer
-- was charged cannot. The same argument applies with more force to the other
-- side of the ledger: a promoter's commission is money owed to a person, and
-- an organiser who drops a code from 10% to 5% in March must not silently
-- reduce what they owe for February's sales.
--
-- So the rate is applied once, at checkout, and the naira figure lives here.
-- `promo_codes.rate` is what NEW sales will use; this is what the old ones
-- actually earned.
--
-- Zero on every existing row, which is correct: the referral codes carried
-- over from 0008 were minted at rate 0, because attribution was all anyone
-- was ever promised.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "commission_amount" numeric(12, 2) NOT NULL DEFAULT 0;

-- "What does this event owe, and to whom" is the query an organiser runs on
-- the day they pay people, and it reads every paid order for the event.
CREATE INDEX IF NOT EXISTS "orders_event_commission_idx"
  ON "orders" ("event_id")
  WHERE "commission_amount" > 0;
