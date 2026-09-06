-- A transfer is confirmed by the destination office, and only then does the
-- money move on both sides. If the sending caisse no longer holds the amount by
-- that time, the person confirming may still force it through: the cash really
-- did arrive, so refusing to record it would make the books lie about the one
-- fact we are certain of.
--
-- The flag exists so the ledger can tell an EXPLAINED negative balance from an
-- accident. Everywhere else, a caisse that would go below zero is refused;
-- replayChain() consults this column to know it must not block later
-- corrections on a caisse whose dip it did not create — including the very
-- correction that fixes it, the missing deposit.
ALTER TABLE office_transfers ADD COLUMN forced BOOLEAN NOT NULL DEFAULT false;

-- The same decision, one level down. `caisse_balances.balance` carried
-- CHECK (balance >= 0), which would refuse the forced confirmation outright —
-- it cannot know about the exception, because a CHECK sees one row and nothing
-- else.
--
-- The rule is not abandoned, it moves up to where the exception is visible:
-- postMovement() refuses an overdraft unless the caller passes allowNegative
-- (one caller does), and replayChain() refuses any edit that would drive a
-- caisse below zero unless the dip is already explained by a forced transfer.
-- What is lost is a last-resort net against a bug writing a negative balance
-- directly; what is gained is the ability to record a shortfall honestly
-- instead of being unable to book cash that really did arrive.
ALTER TABLE caisse_balances DROP CONSTRAINT caisse_balances_balance_check;

-- And the running total on the ledger row itself, for the same reason: it is
-- the stored copy of the balance after that movement, so it goes negative in
-- exactly the same case and no other.
ALTER TABLE transactions DROP CONSTRAINT transactions_balance_after_check;
