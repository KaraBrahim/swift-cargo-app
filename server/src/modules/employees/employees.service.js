// Les salariés et ce qu'on leur verse.
//
// Un salarié a un salaire mensuel. Chaque mois on lui doit ce montant, et on le
// paie en une ou plusieurs fois. C'est tout le modèle — il n'y a pas trois
// sortes de versements à choisir avant de pouvoir taper un chiffre : un
// « acompte » n'est qu'un versement partiel du mois, et le distinguer obligeait
// la personne au comptoir à classer ce qu'elle faisait avant de le faire.
//
// Ce qui est proposé pour le mois : ce qui a été versé le mois DERNIER (le
// salaire suit donc les augmentations sans qu'on y pense), à défaut le salaire
// configuré — moins ce qui a déjà été versé ce mois-ci.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { createCharge } from '../accounts/accounts.service.js';

const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);
const previousMonth = (period) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

export async function listEmployees({ includeInactive = false, period } = {}) {
  const month = period || monthOf();
  const { rows } = await getPool().query(
    `SELECT e.*, c.label AS caisse_label,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id AND period = $1), 0)::text AS paid_this_month,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id AND period = $2), 0)::text AS paid_last_month,
            (SELECT amount     FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_amount,
            (SELECT created_at FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_at
       FROM employees e LEFT JOIN caisses c ON c.id = e.caisse_id
      WHERE ($3 OR e.active)
      ORDER BY e.active DESC, e.name`,
    [month, previousMonth(month), includeInactive]
  );
  return {
    period: month,
    employees: rows.map((e) => {
      // Le mois dernier fait foi : ce qu'on a réellement versé vaut mieux
      // qu'un salaire noté une fois et jamais remis à jour.
      const base = new Decimal(Number(e.paid_last_month) > 0 ? e.paid_last_month : e.salary);
      const remaining = Decimal.max(base.minus(e.paid_this_month), 0);
      return { ...e, base: base.toFixed(2), remaining: remaining.toFixed(2) };
    }),
  };
}

export async function createEmployee({ admin, name, poste, salary, currency, caisseId, note, ip }) {
  const { rows } = await getPool().query(
    `INSERT INTO employees (name, poste, salary, currency_code, caisse_id, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, poste ?? null, new Decimal(salary ?? 0).toFixed(2), currency, caisseId ?? null, note ?? null]
  );
  await writeAudit(getPool(), { adminId: admin.id, action: 'employee.create', entity: 'employee', entityId: rows[0].id, details: { name, salary }, ip });
  return rows[0];
}

export async function updateEmployee({ admin, id, ip, ...data }) {
  const fields = { name: data.name, poste: data.poste, salary: data.salary != null ? new Decimal(data.salary).toFixed(2) : undefined,
    currency_code: data.currency, caisse_id: data.caisseId, active: data.active, note: data.note };
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
