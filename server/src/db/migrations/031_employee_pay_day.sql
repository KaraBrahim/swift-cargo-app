-- Swift Cargo — le jour où le salaire tombe.
--
-- Le salaire ne se gagne pas au jour le jour : il est dû EN ENTIER, une fois
-- par mois, au jour convenu avec la personne. Le compte doit donc compter des
-- salaires — pas des fractions de mois.
--
-- `first_due_on` est la date du PREMIER salaire dû. Chaque mois, au même
-- quantième, un salaire de plus tombe. Les mois trop courts (le 31 en février)
-- tombent le dernier jour du mois.
ALTER TABLE employees ADD COLUMN first_due_on DATE;
UPDATE employees SET first_due_on = created_at::date WHERE first_due_on IS NULL;
ALTER TABLE employees ALTER COLUMN first_due_on SET NOT NULL;
ALTER TABLE employees ALTER COLUMN first_due_on SET DEFAULT CURRENT_DATE;
