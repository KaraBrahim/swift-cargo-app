-- Swift Cargo — le système de remises, complet.
--
-- La remise de règlement (037) savait une chose : solder à un montant rond. Elle
-- devient une décision à part entière — un montant libre, un pourcentage, un
-- arrondi, un solde — avec son MOTIF, tirée d'une liste que le patron tient lui-même.
--
-- Rien n'est réécrit : la remise reste une ligne `remise` du grand livre qui
-- partage la `caisse_tx_id` de son paiement. On lui ajoute seulement de quoi dire
-- de quelle sorte elle est, et pourquoi.

CREATE TABLE remise_reasons (
  id         SERIAL PRIMARY KEY,
  label      TEXT    NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Deux motifs ne diffèrent pas que par la casse.
CREATE UNIQUE INDEX uniq_remise_reason_label ON remise_reasons (lower(btrim(label)));

INSERT INTO remise_reasons (label, sort_order) VALUES
  ('Geste commercial', 10),
  ('Client fidèle', 20),
  ('Retard ou désagrément', 30),
  ('Erreur de saisie', 40),
  ('Arrondi', 50),
  ('Autre', 99);

-- De quelle sorte, de combien en pourcentage, et pourquoi.
ALTER TABLE person_ledger
  ADD COLUMN remise_kind      TEXT CHECK (remise_kind IN ('amount', 'percent', 'round', 'settle')),
  ADD COLUMN remise_percent   NUMERIC(7,4),
  ADD COLUMN remise_reason_id INTEGER REFERENCES remise_reasons(id);

ALTER TABLE employee_remises
  ADD COLUMN kind       TEXT CHECK (kind IN ('amount', 'percent', 'round', 'settle')),
  ADD COLUMN percent    NUMERIC(7,4),
  ADD COLUMN reason_id  INTEGER REFERENCES remise_reasons(id),
  ADD COLUMN note       TEXT;

-- Les remises d'avant n'avaient qu'une forme : on soldait.
UPDATE person_ledger    SET remise_kind = 'settle' WHERE type = 'remise' AND remise_kind IS NULL;
UPDATE employee_remises SET kind        = 'settle' WHERE kind IS NULL;

CREATE INDEX idx_person_ledger_remise ON person_ledger (created_at) WHERE type = 'remise';
