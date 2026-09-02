-- Swift Cargo — two additions to the money model.
--
-- 1. An account is no longer limited to fournisseurs and passagers: an
--    "utilisateur" (an admin — advances, salary, reimbursements) can hold one
--    too, and free-form entries get their own types so a generic transaction is
--    not disguised as an 'adjustment'.
--
-- 2. The company's own running costs (internet, électricité, loyer, salaires…)
--    are recorded as charges. They leave a caisse like any other outflow, but
--    carry a category and an optional period so recurring monthly fees can be
--    tracked and totalled.

ALTER TABLE person_ledger   DROP CONSTRAINT person_ledger_person_type_check;
ALTER TABLE person_balances DROP CONSTRAINT person_balances_person_type_check;
ALTER TABLE person_ledger   ADD CONSTRAINT person_ledger_person_type_check
  CHECK (person_type IN ('fournisseur', 'passager', 'utilisateur'));
ALTER TABLE person_balances ADD CONSTRAINT person_balances_person_type_check
  CHECK (person_type IN ('fournisseur', 'passager', 'utilisateur'));

-- Free-form movements on a person's account, in either direction.
ALTER TABLE person_ledger DROP CONSTRAINT person_ledger_type_check;
ALTER TABLE person_ledger ADD CONSTRAINT person_ledger_type_check
  CHECK (type IN (
    'transport_fee', 'fee_payment', 'passager_due', 'passager_payment', 'adjustment',
    'avance', 'remboursement', 'salaire', 'prime', 'autre'
  ));

-- A charge is an outflow of the business itself, not tied to a person.
ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'deposit', 'withdrawal', 'conversion', 'transfer', 'adjustment',
    'order_fee', 'passager_payment', 'charge'
  ));

CREATE TABLE charges (
  id            BIGSERIAL PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN (
                  'internet', 'electricite', 'eau', 'loyer', 'salaire',
                  'transport', 'fourniture', 'taxe', 'entretien', 'autre')),
  label         TEXT NOT NULL,
  amount        NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  caisse_id     INTEGER NOT NULL REFERENCES caisses(id),
  tx_id         BIGINT REFERENCES transactions(id),
  -- 'YYYY-MM' for a recurring monthly fee; NULL for a one-off.
  period        TEXT,
  recurring     BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  admin_id      INTEGER NOT NULL REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site   TEXT NOT NULL DEFAULT 'cloud'
);
CREATE UNIQUE INDEX charges_uuid_uq ON charges(uuid);
CREATE INDEX idx_charges_period ON charges(period);
CREATE INDEX idx_charges_category ON charges(category);
