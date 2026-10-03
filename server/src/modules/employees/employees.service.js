// Les salariés et ce qu'on leur verse.
//
// Un compte courant, comme celui d'un fournisseur : depuis son embauche,
// l'entreprise lui doit son salaire chaque mois ; chaque versement réduit ce
// qu'elle doit.
//
//     solde = salaire au prorata des jours travaillés − tout ce qui a été versé
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

// Ce que l'entreprise doit entre deux dates, au prorata des JOURS travaillés.
//
// Compter des mois entiers faisait deux salaires à qui était arrivé le 20 du
// mois précédent : son mois d'embauche comptait pour un mois plein, et le
// suivant aussi dès le 1er. Un salaire se gagne jour après jour — chaque jour
// vaut donc le salaire divisé par le nombre de jours de SON mois (28, 30 ou 31,
// pour qu'un mois complet vaille exactement un salaire).
const DAY = 86_400_000;
const utc = (y, m, d) => Date.UTC(y, m, d);
const daysInMonth = (y, m) => (utc(y, m + 1, 1) - utc(y, m, 1)) / DAY;

export function accrued(salary, hiredAt, asOf) {
  const from = new Date(hiredAt), to = new Date(asOf);
  if (to < from) return new Decimal(0);
  let total = new Decimal(0);
  let y = from.getUTCFullYear(), m = from.getUTCMonth();
  while (utc(y, m, 1) <= utc(to.getUTCFullYear(), to.getUTCMonth(), 1)) {
    const monthStart = utc(y, m, 1), monthEnd = utc(y, m + 1, 1);
    // Le premier jour compte : être embauché le 3 et payé le 3, c'est un jour.
    const start = Math.max(monthStart, utc(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = Math.min(monthEnd, utc(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + DAY);
    const days = Math.max(0, (end - start) / DAY);
    total = total.plus(new Decimal(salary).mul(days).div(daysInMonth(y, m)));
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return total;
}

export async function listEmployees({ includeInactive = false, period } = {}) {
  const month = period || monthOf();
  // Un mois passé se lit à sa fin ; le mois en cours s'arrête aujourd'hui.
  const [py, pm] = month.split('-').map(Number);
  const endOfPeriod = new Date(utc(py, pm, 0));
  const asOf = new Date(Math.min(endOfPeriod.getTime(), Date.now()));

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
      const owed = accrued(e.salary, e.created_at, asOf);
      const balance = owed.minus(e.paid_total);
      const days = Math.max(0, Math.floor((asOf - new Date(e.created_at)) / DAY) + 1);
      return {
        ...e,
        days,
        owed_total: owed.toFixed(2),
        balance: balance.toFixed(2),
        remaining: Decimal.max(balance, 0).toFixed(2),
        advance: Decimal.max(balance.negated(), 0).toFixed(2),
      };
    }),
  };
}

export async function createEmployee({ admin, name, salary, currency, caisseId, note, ip }) {
  const { rows } = await getPool().query(
    `INSERT INTO employees (name, salary, currency_code, caisse_id, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, new Decimal(salary ?? 0).toFixed(2), currency, caisseId ?? null, note ?? null]
  );
  await writeAudit(getPool(), { adminId: admin.id, action: 'employee.create', entity: 'employee', entityId: rows[0].id, details: { name, salary }, ip });
  return rows[0];
}

export async function updateEmployee({ admin, id, ip, ...data }) {
  const fields = { name: data.name, salary: data.salary != null ? new Decimal(data.salary).toFixed(2) : undefined,
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
