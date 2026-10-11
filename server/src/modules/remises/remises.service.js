// Les remises : la liste des motifs, et le rapport de tout ce qui a été accordé ou obtenu.
//
// Une remise s'écrit à deux endroits selon qui la reçoit : au grand livre d'une
// personne (fournisseur, passager) et, pour un salaire, dans employee_remises. Le
// rapport les lit ensemble et dit, pour chacune, dans quel sens elle va :
//   accordée — on a laissé tomber de l'argent qu'on nous devait (un fournisseur paie moins)
//   obtenue  — on a payé moins que ce qu'on devait (un passager, un salarié)
// Un arrondi au-dessus inverse le sens ; le signe du grand livre le dit déjà.
import { getPool } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

export async function listReasons({ includeInactive = false } = {}) {
  const { rows } = await getPool().query(
    `SELECT r.id, r.label, r.active, r.sort_order,
            (SELECT COUNT(*)::int FROM person_ledger pl WHERE pl.remise_reason_id = r.id)
          + (SELECT COUNT(*)::int FROM employee_remises er WHERE er.reason_id = r.id) AS uses
       FROM remise_reasons r
      ${includeInactive ? '' : 'WHERE r.active'}
      ORDER BY r.sort_order, r.label`
  );
  return rows;
}

export async function createReason({ admin, label, ip }) {
  const text = label.trim();
  const { rows: dup } = await getPool().query('SELECT 1 FROM remise_reasons WHERE lower(btrim(label)) = lower($1)', [text]);
  if (dup.length) throw errors.conflict('Ce motif existe déjà.');
  const { rows: [max] } = await getPool().query("SELECT COALESCE(MAX(sort_order), 0) AS m FROM remise_reasons WHERE sort_order < 99");
  const { rows: [r] } = await getPool().query(
    'INSERT INTO remise_reasons (label, sort_order) VALUES ($1, $2) RETURNING *', [text, Number(max.m) + 10]
  );
  await writeAudit(getPool(), { adminId: admin.id, action: 'remise_reason.create', entity: 'remise_reason', entityId: r.id, details: { label: text }, ip });
  return r;
}

export async function updateReason({ admin, id, label, active, ip }) {
  const sets = [];
  const params = [id];
  if (label != null) {
    const text = label.trim();
    const { rows: dup } = await getPool().query(
      'SELECT 1 FROM remise_reasons WHERE lower(btrim(label)) = lower($1) AND id <> $2', [text, id]);
    if (dup.length) throw errors.conflict('Ce motif existe déjà.');
    params.push(text); sets.push(`label = $${params.length}`);
  }
  if (active != null) { params.push(Boolean(active)); sets.push(`active = $${params.length}`); }
  if (!sets.length) throw errors.validation([{ field: 'label', message: 'Rien à modifier.' }]);
  const { rows: [r] } = await getPool().query(`UPDATE remise_reasons SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!r) throw errors.notFound('Motif introuvable.');
  await writeAudit(getPool(), { adminId: admin.id, action: 'remise_reason.update', entity: 'remise_reason', entityId: id, details: { label, active }, ip });
  return r;
}

// Toutes les remises d'une période, avec leur sens, et leurs totaux par devise,
// par motif, par administrateur et par sorte.
export async function report({ from, to, personId, adminId, reasonId, kind, direction, limit = 2000 }) {
  const params = [from, to];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (personId) add('x.person_id = ?', personId);
  if (adminId) add('x.admin_id = ?', adminId);
  if (reasonId === 0) where.push('x.reason_id IS NULL');
  else if (reasonId) add('x.reason_id = ?', reasonId);
  if (kind) add('x.kind = ?', kind);
  if (direction === 'accordee') where.push('x.signed > 0');
  if (direction === 'obtenue') where.push('x.signed < 0');

  const { rows } = await getPool().query(
    `SELECT * FROM (
       SELECT 'person' AS source, pl.id, pl.created_at, pl.currency_code,
              pl.amount AS signed, pl.remise_kind AS kind, pl.remise_percent AS percent,
              pl.remise_reason_id AS reason_id, rr.label AS reason, pl.note,
              pl.person_id, pe.name AS person_name, pl.admin_id, a.full_name AS admin_name,
              pl.ref_bon_id AS bon_id, b.reference AS bon_reference,
              pl.ref_order_id AS order_id, o.reference AS order_reference
         FROM person_ledger pl
         JOIN admins a ON a.id = pl.admin_id
         LEFT JOIN remise_reasons rr ON rr.id = pl.remise_reason_id
         LEFT JOIN people pe ON pl.person_type = 'personne' AND pe.id = pl.person_id
         LEFT JOIN bons b ON b.id = pl.ref_bon_id
         LEFT JOIN orders o ON o.id = pl.ref_order_id
        WHERE pl.type = 'remise'
       UNION ALL
       -- Un salaire : ce qu'on n'a pas versé est de l'argent OBTENU, d'où le signe inversé.
       SELECT 'salary', er.id, er.created_at, em.currency_code,
              -er.amount, er.kind, er.percent, er.reason_id, rr.label, er.note,
              NULL::int, em.name, er.admin_id, a.full_name, NULL::bigint, NULL::text, NULL::bigint, NULL::text
         FROM employee_remises er
         JOIN employees em ON em.id = er.employee_id
         JOIN admins a ON a.id = er.admin_id
         LEFT JOIN remise_reasons rr ON rr.id = er.reason_id
     ) x
      WHERE (x.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN $1::date AND $2::date
        ${where.length ? 'AND ' + where.join(' AND ') : ''}
      ORDER BY x.created_at DESC, x.id DESC
      LIMIT ${Number(limit)}`,
    params
  );

  const remises = rows.map((r) => {
    const signed = new Decimal(r.signed);
    return {
      source: r.source, id: r.id, created_at: r.created_at, currency_code: r.currency_code,
      amount: signed.abs().toFixed(2), direction: signed.gt(0) ? 'accordee' : 'obtenue',
      kind: r.kind, percent: r.percent, reason_id: r.reason_id, reason: r.reason,
      // La note par défaut n'apprend rien : on ne montre que celle qu'on a écrite.
      note: r.note === 'Remise de règlement' ? null : r.note,
      person_id: r.person_id, person_name: r.person_name, admin_id: r.admin_id, admin_name: r.admin_name,
      bon_id: r.bon_id, bon_reference: r.bon_reference, order_id: r.order_id, order_reference: r.order_reference,
    };
  });

  // Les totaux : on additionne en Decimal, devise par devise — jamais d'une devise à l'autre.
  const bucket = () => ({ accordee: new Decimal(0), obtenue: new Decimal(0), count: 0 });
  const add2 = (map, key, r) => {
    const b = map.get(key) ?? bucket();
    b[r.direction] = b[r.direction].plus(r.amount);
    b.count += 1;
    map.set(key, b);
  };
  const byCurrency = new Map(); const byReason = new Map(); const byAdmin = new Map(); const byKind = new Map();
  for (const r of remises) {
    add2(byCurrency, r.currency_code, r);
    add2(byReason, `${r.reason ?? 'Sans motif'}|${r.currency_code}`, r);
    add2(byAdmin, `${r.admin_name}|${r.currency_code}`, r);
    add2(byKind, `${r.kind ?? 'settle'}|${r.currency_code}`, r);
  }
  const flat = (map, label) => [...map.entries()].map(([key, b]) => {
    const [name, currency] = key.split('|');
    return { [label]: name, currency_code: currency ?? name, accordee: b.accordee.toFixed(2), obtenue: b.obtenue.toFixed(2), count: b.count };
  });
  return {
    remises,
    totals: {
      byCurrency: [...byCurrency.entries()].map(([code, b]) => ({
        currency_code: code, accordee: b.accordee.toFixed(2), obtenue: b.obtenue.toFixed(2),
        net: b.obtenue.minus(b.accordee).toFixed(2), count: b.count,
      })),
      byReason: flat(byReason, 'reason'),
      byAdmin: flat(byAdmin, 'admin'),
      byKind: flat(byKind, 'kind'),
    },
  };
}
