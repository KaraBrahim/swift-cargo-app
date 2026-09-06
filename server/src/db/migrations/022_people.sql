-- Une personne, une fiche.
--
-- Jusqu'ici un fournisseur et un passager étaient deux espèces différentes :
-- deux tables, deux suites d'identifiants, deux soldes, deux pages. Le même
-- homme qui vend de la marchandise et qui la transporte existait donc deux
-- fois, sans que rien ne relie ses dettes.
--
-- `people` remplace les deux : une ligne par humain, avec un rôle coché ou les
-- deux. Le solde redevient un seul chiffre — ce qu'il vous doit moins ce que
-- vous lui devez — au lieu d'une somme à recalculer dans chaque requête.
--
-- Tout ce fichier s'exécute dans une seule transaction (voir migrate.js) :
-- soit la base entière bascule, soit rien ne bouge.

CREATE TABLE people (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  notes          TEXT,
  is_fournisseur BOOLEAN NOT NULL DEFAULT false,
  is_passager    BOOLEAN NOT NULL DEFAULT false,
  -- Régulier ou auto-entrepreneur : ne concerne que le rôle passager.
  passager_type  TEXT CHECK (passager_type IN ('regular','auto')),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid           UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site    TEXT NOT NULL DEFAULT 'cloud',
  -- Une fiche sans rôle n'est rien : ni fournisseur, ni passager, elle
  -- n'apparaîtrait dans aucune liste et ne pourrait servir à aucun bon.
  CONSTRAINT people_has_role CHECK (is_fournisseur OR is_passager)
);

-- Colonnes de correspondance, le temps de réécrire les liens. Supprimées à la
-- fin du fichier : elles n'ont de sens que pendant la bascule.
ALTER TABLE people ADD COLUMN legacy_kind TEXT;
ALTER TABLE people ADD COLUMN legacy_id   INTEGER;

-- Les triggers CDC (005_sync_engine.sql) sont posés APRÈS la copie : la reprise
-- de l'existant n'est pas un évènement à répliquer, chaque poste applique cette
-- même migration sur ses propres données.
INSERT INTO people (name, phone, notes, is_fournisseur, active, created_at, uuid, origin_site, legacy_kind, legacy_id)
  SELECT name, phone, notes, true, active, created_at, uuid, origin_site, 'fournisseur', id FROM fournisseurs;

INSERT INTO people (name, phone, notes, is_passager, passager_type, active, created_at, uuid, origin_site, legacy_kind, legacy_id)
  SELECT full_name, phone, notes, true, type, active, created_at, uuid, origin_site, 'passager', id FROM passagers;

-- L'uuid de la ligne d'origine est repris tel quel, pas régénéré : deux postes
-- qui appliquent cette migration doivent obtenir le même uuid pour la même
-- personne, sinon la synchronisation la dédoublerait.
CREATE UNIQUE INDEX people_uuid_uq ON people(uuid);
CREATE INDEX idx_people_roles ON people(is_fournisseur, is_passager) WHERE active;

-- ── Les trois clés étrangères réelles ───────────────────────────────────
-- bons.fournisseur_id devient NULLABLE au passage : un bon passager n'a plus un
-- fournisseur mais autant que de lots qu'il transporte, déduits de ses lignes.
ALTER TABLE bons   DROP CONSTRAINT bons_fournisseur_id_fkey;
ALTER TABLE bons   DROP CONSTRAINT bons_passager_id_fkey;
ALTER TABLE orders DROP CONSTRAINT orders_fournisseur_id_fkey;
ALTER TABLE bons   ALTER COLUMN fournisseur_id DROP NOT NULL;

UPDATE bons b SET fournisseur_id = p.id
  FROM people p WHERE p.legacy_kind = 'fournisseur' AND p.legacy_id = b.fournisseur_id;
UPDATE bons b SET passager_id = p.id
  FROM people p WHERE p.legacy_kind = 'passager' AND p.legacy_id = b.passager_id;
UPDATE orders o SET fournisseur_id = p.id
  FROM people p WHERE p.legacy_kind = 'fournisseur' AND p.legacy_id = o.fournisseur_id;

ALTER TABLE bons   ADD CONSTRAINT bons_fournisseur_id_fkey   FOREIGN KEY (fournisseur_id) REFERENCES people(id);
ALTER TABLE bons   ADD CONSTRAINT bons_passager_id_fkey      FOREIGN KEY (passager_id)    REFERENCES people(id);
ALTER TABLE orders ADD CONSTRAINT orders_fournisseur_id_fkey FOREIGN KEY (fournisseur_id) REFERENCES people(id);

-- ── Le compte ───────────────────────────────────────────────────────────
-- 'fournisseur' et 'passager' ne sont plus deux personnes mais deux rôles de la
-- même : le grand livre ne distingue donc plus que 'personne' et 'utilisateur'
-- (un administrateur : avance, salaire, remboursement).
ALTER TABLE person_ledger   DROP CONSTRAINT person_ledger_person_type_check;
ALTER TABLE person_balances DROP CONSTRAINT person_balances_person_type_check;

UPDATE person_ledger l SET person_type = 'personne', person_id = p.id
  FROM people p WHERE p.legacy_kind = l.person_type AND p.legacy_id = l.person_id;

-- Le solde est une projection : on le refait à partir des écritures plutôt que
-- de le réécrire ligne à ligne. Si deux anciennes fiches avaient été le même
-- humain, leurs soldes s'additionnent au lieu de se heurter sur la clé.
--
-- L'ORDRE COMPTE : les anciennes lignes de soldes doivent disparaître AVANT que
-- la nouvelle contrainte n'existe, sinon PostgreSQL la valide contre des lignes
-- encore marquées 'fournisseur' / 'passager' et refuse la migration entière.
DELETE FROM person_balances WHERE person_type IN ('fournisseur','passager');
INSERT INTO person_balances (person_type, person_id, currency_code, balance)
  SELECT person_type, person_id, currency_code, SUM(amount)
    FROM person_ledger WHERE person_type = 'personne'
   GROUP BY person_type, person_id, currency_code;

ALTER TABLE person_ledger   ADD CONSTRAINT person_ledger_person_type_check
  CHECK (person_type IN ('personne','utilisateur'));
ALTER TABLE person_balances ADD CONSTRAINT person_balances_person_type_check
  CHECK (person_type IN ('personne','utilisateur'));

-- Les balance_after de l'historique restent justes : les montants n'ont pas
-- changé, seule la clé de la personne a changé.

-- ── Les triggers de réplication, une fois la table peuplée ──────────────
CREATE TRIGGER people_origin  BEFORE INSERT ON people
  FOR EACH ROW EXECUTE FUNCTION sync_set_origin();
CREATE TRIGGER people_capture AFTER INSERT OR UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION sync_capture();

-- ── Les anciennes tables ────────────────────────────────────────────────
-- Entièrement recopiées ci-dessus. Les garder signifierait deux vérités
-- possibles sur la même personne, et c'est exactement ce que cette migration
-- supprime.
DROP TRIGGER IF EXISTS fournisseurs_origin  ON fournisseurs;
DROP TRIGGER IF EXISTS fournisseurs_capture ON fournisseurs;
DROP TRIGGER IF EXISTS passagers_origin     ON passagers;
DROP TRIGGER IF EXISTS passagers_capture    ON passagers;
DROP TABLE fournisseurs;
DROP TABLE passagers;

ALTER TABLE people DROP COLUMN legacy_kind;
ALTER TABLE people DROP COLUMN legacy_id;
