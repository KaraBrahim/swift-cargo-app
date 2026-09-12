// Les salariés et leurs paies.
//
// Une paie est une charge « salaire » rattachée à un salarié, avec un type :
//   mensuel — le salaire du mois ; le montant proposé est le dernier salaire
//             mensuel versé (le salaire configuré la première fois) ;
//   acompte — une partie prise avant la fin du mois ; elle se déduit de la
//             proposition du mois, pour ne pas payer deux fois ;
//   libre   — n'importe quel montant, sans rien changer aux propositions.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { createCharge } from '../accounts/accounts.service.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

export async function listEmployees({ includeInactive = false } = {}) {
  const period = thisMonth();
  const { rows } = await getPool().query(
    `SELECT e.*, c.label AS caisse_label,
            -- Le dernier salaire mensuel versé : c'est lui qu'on propose.
            (SELECT amount FROM charges WHERE employee_id = e.id AND kind = 'mensuel' ORDER BY created_at DESC LIMIT 1) AS last_monthly,
            (SELECT created_at FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_at,
            (SELECT amount FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_amount,
            (SELECT kind FROM charges WHERE employee_id = e.id ORDER BY created_at DESC LIMIT 1) AS last_paid_kind,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id AND period = $1), 0)::text AS paid_this_month,
            COALESCE((SELECT SUM(amount) FROM charges WHERE employee_id = e.id AND period = $1 AND kind = 'acompte'), 0)::text AS advances_this_month,
            EXISTS (SELECT 1 FROM charges WHERE employee_id = e.id AND period = $1 AND kind = 'mensuel') AS month_paid
       FROM employees e LEFT JOIN caisses c ON c.id = e.caisse_id
      WHERE ($2 OR e.active)
      ORDER BY e.active DESC, e.name`,
    [period, includeInactive]
  );
  return {
    period,
    employees: rows.map((e) => {
      const base = new Decimal(e.last_monthly ?? e.salary);
      return {
        ...e,
        // Ce qu'on proposera pour « payer le mois » : le dernier mensuel, moins
        // les acomptes déjà pris ce mois-ci.
        suggested: Decimal.max(base.minus(e.advances_this_month), 0).toFixed(2),
        suggested_base: base.toFixed(2),
      };
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

// Payer : une charge « salaire » qui sort de la caisse choisie, rattachée au
// salarié, datée du mois. Le mois ne se paie qu'une fois — un second versement
// pour le même mois est un acompte ou un montant libre, et doit le dire.
export async function payEmployee({ admin, id, amount, kind, caisseId, period, note, ip }) {
  const { rows } = await getPool().query('SELECT * FROM employees WHERE id = $1', [id]);
  const e = rows[0];
  if (!e) throw errors.notFound('Salarié introuvable.');
  if (!e.active) throw errors.conflict('Ce salarié n’est plus actif.');
  const month = period || thisMonth();
  const caisse = caisseId ?? e.caisse_id;
  if (!caisse) throw errors.validation([{ field: 'caisseId', message: 'Choisissez la caisse qui paie.' }]);

  if (kind === 'mensuel') {
    const { rows: dup } = await getPool().query(
      "SELECT 1 FROM charges WHERE employee_id = $1 AND period = $2 AND kind = 'mensuel'", [id, month]
    );
    if (dup.length) throw errors.conflict(`Le mois ${month} de ${e.name} est déjà payé. Pour verser plus, choisissez « montant libre ».`);
  }
  const labels = { mensuel: `Salaire ${month}`, acompte: `Acompte ${month}`, libre: `Versement ${month}` };
  return withTx(async (c) => {
    const charge = await createCharge({
      admin, category: 'salaire', label: `${labels[kind]} — ${e.name}`, amount, currency: e.currency_code,
      caisseId: caisse, period: month, recurring: kind === 'mensuel', note, ip,
    }, c);
    await c.query('UPDATE charges SET employee_id = $2, kind = $3 WHERE id = $1', [charge.id, id, kind]);
    return { ...charge, employee_id: id, kind };
  });
}

export async function listPayments(id, limit = 50) {
  const { rows } = await getPool().query(
    `SELECT ch.id, ch.amount, ch.currency_code, ch.kind, ch.period, ch.note, ch.created_at, ch.label,
            c.label AS caisse_label, a.full_name AS admin_name
       FROM charges ch LEFT JOIN caisses c ON c.id = ch.caisse_id LEFT JOIN admins a ON a.id = ch.admin_id
      WHERE ch.employee_id = $1 ORDER BY ch.created_at DESC LIMIT $2`,
    [id, limit]
  );
  return rows;
}
