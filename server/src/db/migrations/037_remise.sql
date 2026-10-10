-- Swift Cargo — la remise de règlement.
--
-- On doit 52 340 DA à quelqu'un, ou il nous les doit : en pratique on se règle à
-- 52 000, ou à 52 500, et la différence est convenue entre les deux. Cette
-- différence doit laisser une TRACE — sinon la dette ne se solde jamais, ou le
-- solde de la personne ment — sans toucher à la caisse, qui ne bouge que du
-- montant RÉELLEMENT versé.
--
-- Elle s'inscrit au compte de la personne sous un type à elle, `remise`, et
-- partage la `caisse_tx_id` du paiement qu'elle accompagne : annuler le paiement
-- l'emporte, et un paiement qui porte une remise ne se corrige plus à la main.
ALTER TABLE person_ledger DROP CONSTRAINT person_ledger_type_check;
ALTER TABLE person_ledger ADD CONSTRAINT person_ledger_type_check
  CHECK (type IN (
    'transport_fee', 'fee_payment', 'passager_due', 'passager_payment',
    'passager_manquant', 'adjustment', 'remise',
    'avance', 'remboursement', 'salaire', 'prime', 'autre'
  ));

-- Un salaire n'a pas de grand livre : son solde est (dû − versé). La remise d'un
-- versement est donc son propre enregistrement, attaché à la charge qui l'a
-- produit — supprimer le versement supprime la remise.
CREATE TABLE employee_remises (
  id          BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  charge_id   BIGINT  NOT NULL REFERENCES charges(id)   ON DELETE CASCADE,
  -- Positif : ce qu'on a laissé tomber du dû. Négatif : ce qu'on a versé en plus
  -- en arrondissant au-dessus.
  amount      NUMERIC(20,2) NOT NULL CHECK (amount <> 0),
  admin_id    INTEGER REFERENCES admins(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_remises_employee ON employee_remises(employee_id);
CREATE UNIQUE INDEX uniq_employee_remise_charge ON employee_remises(charge_id);
