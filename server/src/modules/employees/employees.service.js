// Les salariés et ce qu'on leur verse.
//
// Un compte courant, comme celui d'un fournisseur : depuis son embauche,
// l'entreprise lui doit son salaire chaque mois ; chaque versement réduit ce
// qu'elle doit.
//
//     solde = salaire × salaires tombés − tout ce qui a été versé
//
// Positif, on lui doit. Négatif, il a été payé d'avance et cela vaut pour les
// mois à venir. Rien n'est ramené à zéro : une avance qui disparaît de l'écran
// est une avance qu'on paiera une seconde fois.
//
// Il n'y a donc pas de « sorte » de versement à choisir — acompte, mois,
// prime, avance sont le même geste : on donne de l'argent, le solde suit.
//
// Le salaire configuré fait foi pour tous les mois écoulés : le changer
// recalcule le passé. C'est voulu — une personne qui corrige un salaire mal
// noté veut que son compte dise la vérité, pas qu'il garde l'erreur.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { createCharge } from '../accounts/accounts.service.js';

const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

// Combien de salaires sont tombés, et quand tombe le prochain.
//
// Un salaire est dû EN ENTIER au jour convenu, pas au prorata des jours
// travaillés : au 3 du mois on ne doit pas trois jours de salaire, on doit ce
// qui est tombé le mois dernier. `first_due_on` porte ce jour ; chaque mois, au
// même quantième, un salaire de plus tombe. Un mois trop court (le 31 en
// février) tombe le dernier jour.
const DAY = 86_400_000;
const utc = (y, m, d) => Date.UTC(y, m, d);
const daysInMonth = (y, m) => (utc(y, m + 1, 1) - utc(y, m, 1)) / DAY;
const dueDayIn = (y, m, day) => Math.min(day, daysInMonth(y, m));

// Les jours où un salaire est tombé, du premier au dernier.
export function dueDates(firstDueOn, asOf) {
  const first = new Date(firstDueOn), to = new Date(asOf);
  const day = first.getUTCDate();
  const out = [];
  let y = first.getUTCFullYear(), m = first.getUTCMonth();
  for (;;) {
    const when = utc(y, m, dueDayIn(y, m, day));
    if (when > to.getTime()) break;
    out.push(new Date(when));
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

// Le montant en vigueur à une date : le dernier fixé avant elle, à défaut le
// plus ancien connu (un salaire relevé après coup vaut aussi pour avant).
export function salaryAt(history, when) {
  const t = new Date(when).getTime();
  let best = null;
  for (const h of history) {
    if (new Date(h.effective_from).getTime() <= t) best = h;
  }
  return new Decimal((best ?? history[0])?.amount ?? 0);
}

export function salariesDue(firstDueOn, asOf) {
  const first = new Date(firstDueOn), to = new Date(asOf);
  const day = first.getUTCDate();
  let n = (to.getUTCFullYear() - first.getUTCFullYear()) * 12 + (to.getUTCMonth() - first.getUTCMonth());
  // Le salaire du mois en cours n'est tombé que si son jour est passé.
  if (to.getUTCDate() >= dueDayIn(to.getUTCFullYear(), to.getUTCMonth(), day)) n += 1;
  return Math.max(n, 0);
}

export function nextDueOn(firstDueOn, asOf) {
  const first = new Date(firstDueOn), to = new Date(asOf);
  const day = first.getUTCDate();
  let y = to.getUTCFullYear(), m = to.getUTCMonth();
  if (to < first) return new Date(utc(first.getUTCFullYear(), first.getUTCMonth(), day));
  if (to.getUTCDate() >= dueDayIn(y, m, day)) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return new Date(utc(y, m, dueDayIn(y, m, day)));
}

export async function listEmployees({ includeInactive = false, period } = {}) {
  const month = period || monthOf();
  // Un mois passé se lit à sa fin ; le mois en cours s'arrête aujourd'hui.
  const [py, pm] = month.split('-').map(Number);
  const asOf = new Date(Math.min(utc(py, pm, 0), Date.now()));

  const { rows: hist } = await getPool().query(
    'SELECT employee_id, amount, effective_from FROM employee_salaries ORDER BY employee_id, effective_from, id'
  );
  const byEmployee = new Map();
  for (const h of hist) {
    if (!byEmployee.has(h.employee_id)) byEmployee.set(h.employee_id, []);
    byEmployee.get(h.employee_id).push(h);
  }

  const { rows } = await getPool().query(
    `SELECT e.*, c.label AS caisse_label,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id AND period = $1), 0)::text AS paid_this_month,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id), 0)::text AS paid_total,
            (SELECT amount     FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_amount,
            (SELECT created_at FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_at
       FROM employees e LEFT JOIN caisses c ON c.id = e.caisse_id
      WHERE ($2 OR e.active)
      ORDER BY e.active DESC, e.name`,
    [month, includeInactive]
  );
  return {
    period: month,
    asOf: asOf.toISOString().slice(0, 10),
    employees: rows.map((e) => {
      // Chaque salaire tombé vaut le montant en vigueur CE JOUR-LÀ : une
      // augmentation ne réécrit pas les mois déjà dus.
      const history = byEmployee.get(e.id) ?? [{ amount: e.salary, effective_from: e.first_due_on }];
      const dates = dueDates(e.first_due_on, asOf);
      const months = dates.length;
      const owed = dates.reduce((acc, d) => acc.plus(salaryAt(history, d)), new Decimal(0));
      const balance = owed.minus(e.paid_total);
      return {
        ...e,
        first_due_on: new Date(e.first_due_on).toISOString().slice(0, 10),
        salary_changes: history.length - 1,
        months,
        next_due_on: nextDueOn(e.first_due_on, asOf).toISOString().slice(0, 10),
        owed_total: owed.toFixed(2),
        balance: balance.toFixed(2),
        remaining: Decimal.max(balance, 0).toFixed(2),
        advance: Decimal.max(balance.negated(), 0).toFixed(2),
      };
    }),
  };
}

export async function createEmployee({ admin, name, salary, currency, caisseId, firstDueOn, note, ip }) {
  const { rows } = await getPool().query(
    `INSERT INTO employees (name, salary, currency_code, caisse_id, first_due_on, note)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6) RETURNING *`,
    [name, new Decimal(salary ?? 0).toFixed(2), currency, caisseId ?? null, firstDueOn ?? null, note ?? null]
  );
  await getPool().query(
    'INSERT INTO employee_salaries (employee_id, amount, effective_from, admin_id) VALUES ($1,$2,$3,$4)',
    [rows[0].id, rows[0].salary, rows[0].first_due_on, admin.id]
  );
  await writeAudit(getPool(), { adminId: admin.id, action: 'employee.create', entity: 'employee', entityId: rows[0].id, details: { name, salary }, ip });
  return rows[0];
}

export async function updateEmployee({ admin, id, ip, ...data }) {
  // Pas de `salary` ici : un salaire change À PARTIR D'UNE DATE (changeSalary).
  const fields = { name: data.name,
    currency_code: data.currency, caisse_id: data.caisseId, active: data.active,
    first_due_on: data.firstDueOn, note: data.note };
  const sets = [], params = [id];
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
  if (!sets.length) throw errors.validation([{ field: 'body', message: 'Rien à modifier.' }]);
  const { rows } = await getPool().query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!rows[0]) throw errors.notFound('Salarié introuvable.');
  await writeAudit(getPool(), { adminId: admin.id, action: 'employee.update', entity: 'employee', entityId: id, details: data, ip });
  return rows[0];
}

// Un versement : une charge « salaire » qui sort de la caisse choisie, datée du
// mois. Rien d'autre à décider. Verser plus que prévu est permis — une prime,
// un rattrapage : c'est de l'argent réellement sorti, on l'enregistre.
export async function payEmployee({ admin, id, amount, caisseId, period, note, ip }) {
  const { rows } = await getPool().query('SELECT * FROM employees WHERE id = $1', [id]);
  const e = rows[0];
  if (!e) throw errors.notFound('Salarié introuvable.');
  if (!e.active) throw errors.conflict('Ce salarié n’est plus actif.');
  const month = period || monthOf();
  const caisse = caisseId ?? e.caisse_id;
  if (!caisse) throw errors.validation([{ field: 'caisseId', message: 'Choisissez la caisse qui paie.' }]);

  return withTx(async (c) => {
    const charge = await createCharge({
      admin, category: 'salaire', label: `Salaire ${month} — ${e.name}`, amount, currency: e.currency_code,
      caisseId: caisse, period: month, recurring: true, note, ip,
    }, c);
    await c.query('UPDATE charges SET employee_id = $2 WHERE id = $1', [charge.id, id]);
    return { ...charge, employee_id: id };
  });
}

// Changer le salaire, à partir d'un jour. Ce qui est déjà tombé garde son
// montant : une augmentation ne réécrit pas les mois passés.
export async function changeSalary({ admin, id, amount, effectiveFrom, note, ip }) {
  const amt = new Decimal(amount);
  if (amt.lt(0)) throw errors.invalidAmount('Un salaire ne peut pas être négatif.');
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [id]);
    const e = rows[0];
    if (!e) throw errors.notFound('Salarié introuvable.');
    const from = effectiveFrom || new Date().toISOString().slice(0, 10);
    await c.query(
      'INSERT INTO employee_salaries (employee_id, amount, effective_from, note, admin_id) VALUES ($1,$2,$3,$4,$5)',
      [id, amt.toFixed(2), from, note ?? null, admin.id]
    );
    // `employees.salary` reste le salaire EN COURS : celui en vigueur
    // aujourd'hui, pas forcément celui qu'on vient d'inscrire pour plus tard.
    const { rows: [cur] } = await c.query(
      `SELECT amount FROM employee_salaries
        WHERE employee_id = $1 AND effective_from <= CURRENT_DATE
        ORDER BY effective_from DESC, id DESC LIMIT 1`, [id]
    );
    if (cur) await c.query('UPDATE employees SET salary = $2 WHERE id = $1', [id, cur.amount]);
    await writeAudit(c, { adminId: admin.id, action: 'employee.salary', entity: 'employee', entityId: id, details: { amount: amt.toFixed(2), from }, ip });
    return (await c.query('SELECT * FROM employees WHERE id=$1', [id])).rows[0];
  });
}

export async function listSalaries(id) {
  const { rows } = await getPool().query(
    `SELECT s.id, s.amount, s.effective_from, s.note, s.created_at, a.full_name AS admin_name
       FROM employee_salaries s LEFT JOIN admins a ON a.id = s.admin_id
      WHERE s.employee_id = $1 ORDER BY s.effective_from DESC, s.id DESC`, [id]
  );
  return rows;
}

export async function listPayments(id, limit = 50) {
  const { rows } = await getPool().query(
    `SELECT ch.id, ch.amount, ch.currency_code, ch.period, ch.note, ch.created_at, ch.label,
            c.label AS caisse_label, a.full_name AS admin_name
       FROM charges ch LEFT JOIN caisses c ON c.id = ch.caisse_id LEFT JOIN admins a ON a.id = ch.admin_id
      WHERE ch.employee_id = $1 ORDER BY ch.created_at DESC LIMIT $2`,
    [id, limit]
  );
  return rows;
}
