// Per-person accounts. Append-only ledger; the
// balance is the running sum. Convention: balance = net the BUSINESS OWES the
// person (payable > 0, receivable < 0). appendEntry runs inside a caller's tx so
// it posts atomically with the caisse movement that caused it.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { postMovement, replayChain } from '../caisse/caisse.service.js';

export async function appendEntry(client, {
  personType, personId, currency, amount, type,
  refOrderId, refBonId, caisseTxId, adminId, note,
}) {
  const amt = new Decimal(amount);
  await client.query(
    `INSERT INTO person_balances (person_type, person_id, currency_code) VALUES ($1,$2,$3)
     ON CONFLICT (person_type, person_id, currency_code) DO NOTHING`,
    [personType, personId, currency]
  );
  const { rows } = await client.query(
    `SELECT balance FROM person_balances
      WHERE person_type=$1 AND person_id=$2 AND currency_code=$3 FOR UPDATE`,
    [personType, personId, currency]
  );
  const newBalance = new Decimal(rows[0].balance).plus(amt).toFixed(2);
  await client.query(
    `UPDATE person_balances SET balance=$4
      WHERE person_type=$1 AND person_id=$2 AND currency_code=$3`,
    [personType, personId, currency, newBalance]
  );
  const ins = await client.query(
    `INSERT INTO person_ledger
       (person_type, person_id, currency_code, amount, balance_after, type,
        ref_order_id, ref_bon_id, caisse_tx_id, admin_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [personType, personId, currency, amt.toFixed(2), newBalance, type,
     refOrderId ?? null, refBonId ?? null, caisseTxId ?? null, adminId, note ?? null]
  );
  return ins.rows[0];
}

// A person's balance is a running total, exactly like a caisse's. Removing an
// entry therefore invalidates every later balance_after, so replay the chain
// from the entries themselves rather than patching one row.
export async function replayPersonLedger(c, personType, personId, currency) {
  await c.query(
    `WITH ordered AS (
       SELECT id, SUM(amount) OVER (ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
         FROM person_ledger
        WHERE person_type=$1 AND person_id=$2 AND currency_code=$3
     )
     UPDATE person_ledger p SET balance_after = o.running FROM ordered o WHERE p.id = o.id`,
    [personType, personId, currency]
  );
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(amount),0) AS bal FROM person_ledger
      WHERE person_type=$1 AND person_id=$2 AND currency_code=$3`,
    [personType, personId, currency]
  );
  const bal = new Decimal(rows[0].bal).toFixed(2);
  await c.query(
    `INSERT INTO person_balances (person_type, person_id, currency_code, balance) VALUES ($1,$2,$3,$4)
     ON CONFLICT (person_type, person_id, currency_code) DO UPDATE SET balance = EXCLUDED.balance`,
    [personType, personId, currency, bal]
  );
  return bal;
}

export async function getAccount(personType, personId) {
  const table = PERSON_TABLE[personType] ?? 'people';
  // `admins` names the column full_name, `people` names it name. Both come back
  // as `name`, so a caller never has to know which table answered.
  const nameCol = table === 'admins' ? 'full_name' : 'name';
  // Full profile record (phone, roles, notes, created_at) + a display name.
  const { rows: person } = await getPool().query(
    `SELECT *, ${nameCol} AS name FROM ${table} WHERE id=$1`, [personId]
  );
  if (!person[0]) throw errors.notFound('Personne introuvable.');

  const [balances, entries] = await Promise.all([
    getPool().query(
      `SELECT pb.currency_code, pb.balance, c.name AS currency_name
         FROM person_balances pb JOIN currencies c ON c.code = pb.currency_code
        WHERE pb.person_type=$1 AND pb.person_id=$2 ORDER BY c.sort_order`,
      [personType, personId]
    ),
    getPool().query(
      `SELECT pl.*, a.full_name AS admin_name, a.role AS admin_role,
              o.reference AS order_reference, b.reference AS bon_reference
         FROM person_ledger pl
         JOIN admins a ON a.id = pl.admin_id
         LEFT JOIN orders o ON o.id = pl.ref_order_id
         LEFT JOIN bons b ON b.id = pl.ref_bon_id
        WHERE pl.person_type=$1 AND pl.person_id=$2
        ORDER BY pl.created_at DESC, pl.id DESC LIMIT 200`,
      [personType, personId]
    ),
  ]);
  // NOTE: keep the row's own `passager_type` (regular|auto) intact — expose the
  // ledger's person kind separately as `person_type`.
  return { person: { ...person[0], person_type: personType }, balances: balances.rows, entries: entries.rows };
}

// Settle a person's running balance from their profile, independently of any one
// bon — them paying down what they owe, or us paying what we owe them. Cash
// moves through an office caisse and the ledger entry closes the gap.
//
// The direction can no longer be read off the person: the same human may owe as
// a fournisseur and be owed as a passager. The caller states it; left unsaid it
// follows the sign of the balance — negative means they owe us, so money comes
// IN — which is exactly what the button on the profile offers.
export async function settleAccount({ admin, personId, caisseId, amount, currency = 'DZD', direction, note, ip }) {
  const personType = 'personne';
  return withTx(async (c) => {
    const person = await c.query('SELECT 1 FROM people WHERE id=$1 AND active=TRUE', [personId]);
    if (!person.rows.length) throw errors.notFound('Personne introuvable ou inactive.');

    const amt = new Decimal(amount);
    if (!amt.gt(0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');
    if (amt.decimalPlaces() > 2) throw errors.invalidAmount('Montant : maximum 2 décimales.');

    let incoming;
    if (direction === 'in' || direction === 'out') incoming = direction === 'in';
    else {
      const { rows } = await c.query(
        'SELECT balance FROM person_balances WHERE person_type=$1 AND person_id=$2 AND currency_code=$3',
        [personType, personId, currency]
      );
      incoming = new Decimal(rows[0]?.balance ?? 0).lte(0);
    }
    const { txId } = await postMovement(c, {
      caisseId, currency, direction: incoming ? 'in' : 'out', amount: amt.toFixed(2),
      type: incoming ? 'order_fee' : 'passager_payment',
      note: note ?? (incoming ? 'Règlement de dette' : 'Paiement'),
      adminId: admin.id,
    });
    // Money received moves a negative balance up; money paid moves a positive
    // balance down. One account, whichever role the movement came from.
    const entry = await appendEntry(c, {
      personType, personId, currency,
      amount: incoming ? amt.toFixed(2) : amt.negated().toFixed(2),
      type: incoming ? 'fee_payment' : 'passager_payment',
      caisseTxId: txId, adminId: admin.id, note,
    });
    await writeAudit(c, {
      adminId: admin.id, action: 'person.settle', entity: 'person', entityId: personId,
      details: { amount: amt.toFixed(2), currency, caisseId }, ip,
    });
    return { entry, balance: entry.balance_after };
  });
}

// ── Generic person transaction ───────────────────────────────────────
// Beyond the automatic bon flows, any person — or an utilisateur (admin:
// advance, salary, reimbursement) — can receive a free-form entry. `direction`
// says which way the cash goes: 'in' = they hand money over, 'out' = the
// business pays them. Passing a caisse makes it a real cash movement; omitting
// it books a paper entry only (a due, a correction).
//
// 'personne' covers fournisseurs and passagers alike — since migration 022 they
// are two roles of one record. 'utilisateur' stays apart: that is an admin.
const PERSON_TABLE = { personne: 'people', utilisateur: 'admins' };

export async function createPersonTransaction({
  admin, personType, personId, direction, amount, currency = 'DZD',
  type = 'autre', caisseId, note, ip,
}) {
  const table = PERSON_TABLE[personType];
  if (!table) throw errors.validation([{ field: 'personType', message: 'Type de personne invalide.' }]);
  if (!['in', 'out'].includes(direction)) throw errors.validation([{ field: 'direction', message: 'Sens invalide.' }]);

  return withTx(async (c) => {
    // admins have no `active` flag in the same sense; check existence only.
    const exists = await c.query(
      personType === 'utilisateur' ? 'SELECT 1 FROM admins WHERE id=$1' : `SELECT 1 FROM ${table} WHERE id=$1 AND active=TRUE`,
      [personId]
    );
    if (!exists.rows.length) throw errors.notFound('Personne introuvable.');

    const amt = new Decimal(amount);
    if (!amt.gt(0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');
    if (amt.decimalPlaces() > 2) throw errors.invalidAmount('Montant : maximum 2 décimales.');

    let txId = null;
    if (caisseId) {
      ({ txId } = await postMovement(c, {
        caisseId, currency, direction, amount: amt.toFixed(2),
        type: direction === 'in' ? 'deposit' : 'withdrawal',
        note: note ?? `Opération ${personType}`, adminId: admin.id,
      }));
    }
    // Balance convention: > 0 = the business owes them. Cash in from them
    // reduces what we owe; cash out to them is booked the other way.
    const signed = direction === 'in' ? amt.toFixed(2) : amt.negated().toFixed(2);
    const entry = await appendEntry(c, {
      personType, personId, currency, amount: signed, type,
      caisseTxId: txId, adminId: admin.id, note,
    });
    await writeAudit(c, {
      adminId: admin.id, action: 'person.transaction', entity: personType, entityId: personId,
      details: { direction, amount: amt.toFixed(2), currency, type, caisseId: caisseId ?? null }, ip,
    });
    return { entry, balance: entry.balance_after };
  });
}

// ── Company charges (internet, électricité, loyer, salaires…) ────────
export async function listCharges({ category, period, limit = 200 } = {}) {
  const params = [limit];
  const conds = [];
  if (category) { params.push(category); conds.push(`ch.category = $${params.length}`); }
  if (period) { params.push(period); conds.push(`ch.period = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await getPool().query(
    `SELECT ch.*, c.label AS caisse_label, a.full_name AS admin_name, a.role AS admin_role
       FROM charges ch
       JOIN caisses c ON c.id = ch.caisse_id
       JOIN admins a ON a.id = ch.admin_id
       ${where} ORDER BY ch.created_at DESC, ch.id DESC LIMIT $1`,
    params
  );
  const totals = rows.reduce((acc, r) => {
    acc[r.currency_code] = (acc[r.currency_code] || 0) + Number(r.amount);
    return acc;
  }, {});
  const byCategory = rows.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + Number(r.amount);
    return acc;
  }, {});
  return { charges: rows, totals, byCategory };
}

export async function createCharge({ admin, category, label, amount, currency = 'DZD', caisseId, period, recurring, note, ip }) {
  return withTx(async (c) => {
    const amt = new Decimal(amount);
    if (!amt.gt(0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');
    const { txId } = await postMovement(c, {
      caisseId, currency, direction: 'out', amount: amt.toFixed(2), type: 'charge',
      note: note ?? label, adminId: admin.id,
    });
    const { rows } = await c.query(
      `INSERT INTO charges (category, label, amount, currency_code, caisse_id, tx_id, period, recurring, note, admin_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [category, label, amt.toFixed(2), currency, caisseId, txId, period ?? null, Boolean(recurring), note ?? null, admin.id]
    );
    await writeAudit(c, { adminId: admin.id, action: 'charge.create', entity: 'charge', entityId: rows[0].id, details: { category, amount: amt.toFixed(2), currency }, ip });
    return rows[0];
  });
}

export async function updateCharge({ admin, id, label, amount, category, period, recurring, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM charges WHERE id=$1 FOR UPDATE', [id]);
    const ch = rows[0];
    if (!ch) throw errors.notFound('Charge introuvable.');
    const amt = amount != null && amount !== '' ? new Decimal(amount) : new Decimal(ch.amount);
    if (!amt.gt(0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');

    if (ch.tx_id) {
      await c.query('UPDATE transactions SET amount=$2, note=$3 WHERE id=$1', [ch.tx_id, amt.toFixed(2), note ?? ch.note ?? label ?? ch.label]);
      await replayChain(c, ch.caisse_id, ch.currency_code);
    }
    const upd = await c.query(
      `UPDATE charges SET label=COALESCE($2,label), amount=$3, category=COALESCE($4,category),
              period=COALESCE($5,period), recurring=COALESCE($6,recurring), note=COALESCE($7,note)
        WHERE id=$1 RETURNING *`,
      [id, label ?? null, amt.toFixed(2), category ?? null, period ?? null, recurring ?? null, note ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'charge.update', entity: 'charge', entityId: id, details: { from: ch.amount, to: amt.toFixed(2) }, ip });
    return upd.rows[0];
  });
}

export async function deleteCharge({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM charges WHERE id=$1 FOR UPDATE', [id]);
    const ch = rows[0];
    if (!ch) throw errors.notFound('Charge introuvable.');
    await c.query('DELETE FROM charges WHERE id=$1', [id]);
    if (ch.tx_id) {
      await c.query('DELETE FROM transactions WHERE id=$1', [ch.tx_id]);
      await replayChain(c, ch.caisse_id, ch.currency_code);
    }
    await writeAudit(c, { adminId: admin.id, action: 'charge.delete', entity: 'charge', entityId: id, details: { label: ch.label, amount: ch.amount }, ip });
    return { deleted: true };
  });
}

// ── Payment CRUD ──────────────────────────────────────────────────────
// A "payment" is a person_ledger entry of type fee_payment / passager_payment,
// usually paired with a caisse movement. The two must always move together, so
// every edit/delete goes through here — whether the user came from a bon, a
// person's profile, or the caisse list.
async function loadPayment(c, entryId) {
  const { rows } = await c.query('SELECT * FROM person_ledger WHERE id=$1 FOR UPDATE', [entryId]);
  const entry = rows[0];
  if (!entry) throw errors.notFound('Paiement introuvable.');
  if (!['fee_payment', 'passager_payment'].includes(entry.type)) {
    throw errors.conflict('Cette écriture n’est pas un paiement : elle découle d’un bon et se corrige depuis celui-ci.');
  }
  return entry;
}

export async function updatePayment({ admin, entryId, amount, note, ip }) {
  return withTx(async (c) => {
    const entry = await loadPayment(c, entryId);
    const next = amount != null && amount !== '' ? new Decimal(amount) : new Decimal(entry.amount).abs();
    if (!next.gt(0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');
    if (next.decimalPlaces() > 2) throw errors.invalidAmount('Montant : maximum 2 décimales.');

    // Keep the ledger's sign: fournisseurs pay in (+), passagers are paid out (−).
    const signed = entry.type === 'fee_payment' ? next.toFixed(2) : next.negated().toFixed(2);
    await c.query('UPDATE person_ledger SET amount=$2, note=$3 WHERE id=$1', [entryId, signed, note ?? entry.note]);
    await replayPersonLedger(c, entry.person_type, entry.person_id, entry.currency_code);

    if (entry.caisse_tx_id) {
      const tx = (await c.query('SELECT * FROM transactions WHERE id=$1', [entry.caisse_tx_id])).rows[0];
      if (tx) {
        await c.query('UPDATE transactions SET amount=$2, note=$3 WHERE id=$1', [tx.id, next.toFixed(2), note ?? tx.note]);
        await replayChain(c, tx.caisse_id, tx.currency_code);
      }
    }
    await writeAudit(c, {
      adminId: admin.id, action: 'payment.update', entity: 'person_ledger', entityId: entryId,
      details: { from: entry.amount, to: signed }, ip,
    });
    return (await c.query('SELECT * FROM person_ledger WHERE id=$1', [entryId])).rows[0];
  });
}

export async function deletePayment({ admin, entryId, ip }) {
  return withTx(async (c) => {
    const entry = await loadPayment(c, entryId);
    // person_ledger.caisse_tx_id references transactions, so the ledger row goes first.
    const tx = entry.caisse_tx_id
      ? (await c.query('SELECT * FROM transactions WHERE id=$1', [entry.caisse_tx_id])).rows[0]
      : null;

    await c.query('DELETE FROM person_ledger WHERE id=$1', [entryId]);
    await replayPersonLedger(c, entry.person_type, entry.person_id, entry.currency_code);

    if (tx) {
      await c.query('DELETE FROM transactions WHERE id=$1', [tx.id]);
      await replayChain(c, tx.caisse_id, tx.currency_code);
    }
    await writeAudit(c, {
      adminId: admin.id, action: 'payment.delete', entity: 'person_ledger', entityId: entryId,
      details: { type: entry.type, amount: entry.amount, currency: entry.currency_code }, ip,
    });
    return { deleted: true };
  });
}

// Every open obligation, both directions: what people still owe us and what we
// still owe them. Balance convention: > 0 = we owe them.
export async function listDebts() {
  const { rows } = await getPool().query(
    `SELECT pb.person_type, pb.person_id, pb.currency_code, pb.balance,
            pe.name AS person_name, pe.phone, pe.is_fournisseur, pe.is_passager,
            (SELECT MAX(pl.created_at) FROM person_ledger pl
              WHERE pl.person_type = pb.person_type AND pl.person_id = pb.person_id
                AND pl.currency_code = pb.currency_code) AS last_activity
       FROM person_balances pb
       LEFT JOIN people pe ON pb.person_type='personne' AND pe.id = pb.person_id
      WHERE pb.balance <> 0
      ORDER BY ABS(pb.balance) DESC`
  );
  // Split by direction so the UI never has to reason about the sign convention.
  const toPay = rows.filter((r) => Number(r.balance) > 0);      // we owe them
  const toCollect = rows.filter((r) => Number(r.balance) < 0);  // they owe us
  const sum = (list) => list.reduce((acc, r) => {
    acc[r.currency_code] = (acc[r.currency_code] || 0) + Math.abs(Number(r.balance));
    return acc;
  }, {});
  return { toPay, toCollect, totals: { toPay: sum(toPay), toCollect: sum(toCollect) } };
}

// Everything actually settled in cash, both directions, newest first.
export async function listPayments({ personType, limit = 200 } = {}) {
  const params = [limit];
  let extra = '';
  if (personType) { params.push(personType); extra = `AND pl.person_type = $${params.length}`; }
  const { rows } = await getPool().query(
    `SELECT pl.id, pl.person_type, pl.person_id, pl.type, pl.amount, pl.currency_code,
            pl.created_at, pl.note, pl.caisse_tx_id,
            pe.name AS person_name,
            a.full_name AS admin_name, a.role AS admin_role, c.label AS caisse_label,
            b.reference AS bon_reference, b.id AS bon_id
       FROM person_ledger pl
       JOIN admins a ON a.id = pl.admin_id
       LEFT JOIN people pe ON pl.person_type='personne' AND pe.id = pl.person_id
       LEFT JOIN transactions t ON t.id = pl.caisse_tx_id
       LEFT JOIN caisses c ON c.id = t.caisse_id
       LEFT JOIN bons b ON b.id = pl.ref_bon_id
      WHERE pl.type IN ('fee_payment','passager_payment') ${extra}
      ORDER BY pl.created_at DESC, pl.id DESC LIMIT $1`,
    params
  );
  const totals = rows.reduce((acc, r) => {
    const key = r.type === 'fee_payment' ? 'collected' : 'paid';
    acc[key][r.currency_code] = (acc[key][r.currency_code] || 0) + Math.abs(Number(r.amount));
    return acc;
  }, { collected: {}, paid: {} });
  return { payments: rows, totals };
}

export async function getSummary() {
  const { rows } = await getPool().query(
    // By the sign, not by the role: one person can owe you as a fournisseur and
    // be owed as a passager, and their balance is already that net.
    `SELECT currency_code,
            SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END) AS receivable,
            SUM(CASE WHEN balance > 0 THEN  balance ELSE 0 END) AS payable
       FROM person_balances GROUP BY currency_code`
  );
  const receivables = {}, payables = {};
  for (const r of rows) { receivables[r.currency_code] = r.receivable; payables[r.currency_code] = r.payable; }
  return { receivables, payables };
}
