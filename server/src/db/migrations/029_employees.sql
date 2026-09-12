-- Swift Cargo — les salariés, et leurs paies.
--
-- Une paie est une charge (catégorie « salaire ») qui sort d'une caisse, comme
-- avant. Ce qui manquait : à QUI elle va, et de quel TYPE elle est — le mois,
-- un acompte avant la fin du mois, ou un montant libre. C'est ce qui permet de
-- proposer le bon montant le mois suivant (le dernier salaire versé) et de dire
-- combien a déjà été pris ce mois-ci.

CREATE TABLE employees (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  poste         TEXT,
  salary        NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  caisse_id     INTEGER REFERENCES caisses(id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
  origin_site   TEXT NOT NULL DEFAULT 'cloud'
);
CREATE UNIQUE INDEX employees_uuid_uq ON employees(uuid);

ALTER TABLE charges ADD COLUMN employee_id INTEGER REFERENCES employees(id);
ALTER TABLE charges ADD COLUMN kind TEXT CHECK (kind IN ('mensuel', 'acompte', 'libre'));
CREATE INDEX idx_charges_employee ON charges(employee_id, created_at DESC);

-- Même réplication que les autres tables opérationnelles.
CREATE TRIGGER employees_origin BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_set_origin();
CREATE TRIGGER employees_capture AFTER INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_capture();
CREATE TRIGGER employees_capture_del AFTER DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_capture_delete();
