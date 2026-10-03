-- Swift Cargo — un salaire a une date d'effet.
--
-- `employees.salary` ne portait qu'un chiffre. Le corriger recalculait tout le
-- passé : augmenter quelqu'un aujourd'hui lui devait rétroactivement la
-- différence sur chaque mois déjà payé. Une augmentation vaut à partir d'un
-- jour, pas depuis toujours.
--
-- Le salaire devient donc une suite de montants datés. `employees.salary` reste
-- — c'est le salaire EN COURS, celui qu'on lit partout — mais ce qui est dû se
-- calcule avec le montant en vigueur au jour où chaque salaire est tombé.
CREATE TABLE employee_salaries (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount         NUMERIC(20,2) NOT NULL CHECK (amount >= 0),
  effective_from DATE NOT NULL,
  note           TEXT,
  admin_id       INTEGER REFERENCES admins(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_salaries ON employee_salaries(employee_id, effective_from DESC);

-- Le salaire d'aujourd'hui vaut depuis le premier jour de paie : sans cette
-- ligne, les salariés déjà saisis n'auraient aucun montant en vigueur.
INSERT INTO employee_salaries (employee_id, amount, effective_from)
  SELECT id, salary, first_due_on FROM employees;
