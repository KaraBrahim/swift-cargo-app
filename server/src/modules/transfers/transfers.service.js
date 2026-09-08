// Cash transfers between caisses — the only kind there is. Each caisse belongs
// to exactly one office, so choosing the destination caisse already chooses the
// destination office; there is no separate "internal" transfer.
//
// NOTHING MOVES UNTIL THE DESTINATION CONFIRMS. Sending writes a pending row and
// no money at all; confirming writes BOTH legs at once inside one transaction.
// Between the two, the amount is a claim, not a movement — which is why the
// pending amount is not reserved and the sending caisse can be emptied
// meanwhile. See receiveTransfer() for what happens then.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal, parseAmount } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { postMovement, replayChain } from '../caisse/caisse.service.js';

// Both office caisses, by id, locked in the caller's transaction.
async function loadOfficeCaisse(c, id, label) {
  const { rows } = await c.query("SELECT * FROM caisses WHERE id = $1 AND kind = 'office'", [id]);
  if (!rows[0]) throw errors.notFound(`${label} introuvable.`);
  return rows[0];
}

// Exact, never a double: this number decides whether a transfer is short, and
// therefore whether a caisse is knowingly pushed negative.
const balanceOf = async (c, caisseId, currency) => {
  const { rows } = await c.query(
    'SELECT balance FROM caisse_balances WHERE caisse_id = $1 AND currency_code = $2',
    [caisseId, currency]
  );
  return new Decimal(rows[0]?.balance ?? 0);
};

export async function listTransfers({ status, limit = 100 } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE t.status = $${params.length}`; }
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT t.*, sc.label AS sent_caisse_label, rc.label AS received_caisse_label,
            sa.full_name AS sent_by_name, sa.role AS sent_by_role, ra.full_name AS received_by_name, ra.role AS received_by_role
       FROM office_transfers t
       LEFT JOIN caisses sc ON sc.id = t.sent_caisse_id
       LEFT JOIN caisses rc ON rc.id = t.received_caisse_id
       LEFT JOIN admins sa ON sa.id = t.sent_by
       LEFT JOIN admins ra ON ra.id = t.received_by
       ${where} ORDER BY t.sent_at DESC, t.id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// Sending only records the intent: a pending row, no movement. The money is
// still in the origin's till and the books must say so.
export async function sendTransfer({ admin, fromCaisseId, toCaisseId, currency, amount, note, ip }) {
  return withTx(async (c) => {
    const from = await loadOfficeCaisse(c, fromCaisseId, 'Caisse d’origine');
    const to = await loadOfficeCaisse(c, toCaisseId, 'Caisse de destination');
    if (from.id === to.id) throw errors.conflict('Caisses d’origine et de destination identiques.');

    // Checked here as a courtesy — you should not be able to promise money the
    // till does not hold. It is checked again at confirmation, because nothing
    // reserves it in between.
    // Parsed here rather than trusted: the route accepts a numeric string, this
    // is where it becomes an amount with a scale and a ceiling.
    const amt = parseAmount(amount, 2, 'Montant');
    const available = await balanceOf(c, from.id, currency);
    if (available.lt(amt)) {
      throw errors.insufficientFunds({
        currency, available: available.toFixed(2), required: amt.toFixed(2),
      });
    }

    const ins = await c.query(
      `INSERT INTO office_transfers
         (from_office, to_office, currency_code, amount, sent_caisse_id, received_caisse_id, sent_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [from.office, to.office, currency, amt.toFixed(2), from.id, to.id, admin.id, note ?? null]
    );
    await writeAudit(c, {
      adminId: admin.id, action: 'transfer.send', entity: 'office_transfer', entityId: ins.rows[0].id,
      details: { fromCaisseId: from.id, toCaisseId: to.id, currency, amount }, ip,
    });
    return ins.rows[0];
  });
}

// A transfer can still be reshaped while the cash is in the air. Once the
// destination has received it, both offices have booked their leg, so the change
// must be un-received first (or corrected as a new transfer).
function assertPending(t) {
  if (t.status !== 'envoye') {
    throw errors.conflict('Transfert déjà reçu : annulez d’abord la réception au bureau destinataire.');
  }
}

export async function updateTransfer({ admin, id, amount, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id=$1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    assertPending(t);

    const next = amount != null && amount !== ''
      ? parseAmount(amount, 2, 'Montant').toFixed(2)
      : t.amount;

    // Nothing was posted at send time, so there is no ledger row to reshape and
    // no chain to replay — the pending transfer is just a note to ourselves.
    const upd = await c.query(
      'UPDATE office_transfers SET amount=$2, note=COALESCE($3, note) WHERE id=$1 RETURNING *',
      [id, next, note ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'transfer.update', entity: 'office_transfer', entityId: id, details: { from: t.amount, to: next }, ip });
    return upd.rows[0];
  });
}

export async function deleteTransfer({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id=$1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    assertPending(t);

    // No movement was ever written, so cancelling leaves no trace to undo.
    await c.query('DELETE FROM office_transfers WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'transfer.delete', entity: 'office_transfer', entityId: id, details: { reference: t.reference, amount: t.amount }, ip });
    return { deleted: true, reference: t.reference };
  });
}

// Undo a confirmation: both legs are removed and the transfer goes back to
// pending, i.e. back to moving no money at all.
export async function unreceiveTransfer({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id=$1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    if (t.status !== 'recu') throw errors.conflict('Ce transfert n’a pas encore été reçu.');

    for (const [txId, caisseId] of [[t.sent_tx_id, t.sent_caisse_id], [t.received_tx_id, t.received_caisse_id]]) {
      if (!txId) continue;
      await c.query('DELETE FROM transactions WHERE id=$1', [txId]);
      await replayChain(c, caisseId, t.currency_code);
    }
    const upd = await c.query(
      `UPDATE office_transfers SET status='envoye', sent_tx_id=NULL, received_tx_id=NULL,
              received_by=NULL, received_at=NULL, forced=false WHERE id=$1 RETURNING *`, [id]
    );
    await writeAudit(c, { adminId: admin.id, action: 'transfer.unreceive', entity: 'office_transfer', entityId: id, ip });
    return upd.rows[0];
  });
}

// Confirming is where the money actually moves — both legs, one transaction,
// all or nothing.
//
// The sending caisse may no longer hold the amount: nothing reserved it while
// the transfer was pending. That is not something this function can decide, so
// it refuses and hands the UI the numbers to put in front of a human, who
// either forces it through (`force`) or cancels the transfer. Forcing is
// recorded: the cash did arrive, so the origin's negative balance is the honest
// statement that an entry is missing there.
export async function receiveTransfer({ admin, id, toCaisseId, force = false, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id = $1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    if (t.status !== 'envoye') throw errors.conflict('Transfert déjà reçu.');

    // The destination was chosen when the transfer was created; a caller may
    // still name it, and then it has to be the same one.
    const destinationId = t.received_caisse_id ?? toCaisseId;
    const to = await loadOfficeCaisse(c, destinationId, 'Caisse de destination');
    if (toCaisseId && Number(toCaisseId) !== to.id) {
      throw errors.conflict('Ce transfert est destiné à une autre caisse.');
    }

    const available = await balanceOf(c, t.sent_caisse_id, t.currency_code);
    const short = new Decimal(t.amount).minus(available);
    const isShort = short.gt(0);
    if (isShort && !force) {
      throw errors.insufficientFunds({
        currency: t.currency_code,
        available: available.toFixed(2),
        required: new Decimal(t.amount).toFixed(2),
      });
    }

    // Locked in ascending id order, the same rule the rest of the ledger
    // follows, so two confirmations in opposite directions cannot deadlock.
    const legs = [
      { caisseId: t.sent_caisse_id, direction: 'out', note: note ?? `Transfert ${t.reference} vers ${t.to_office}` },
      { caisseId: to.id, direction: 'in', note: note ?? `Réception transfert ${t.reference}` },
    ].sort((a, b) => a.caisseId - b.caisseId);

    const txIds = {};
    for (const leg of legs) {
      const { txId } = await postMovement(c, {
        caisseId: leg.caisseId, currency: t.currency_code, direction: leg.direction,
        amount: t.amount, type: 'transfer', note: leg.note, adminId: admin.id,
        allowNegative: force && leg.direction === 'out',
      });
      txIds[leg.direction] = txId;
    }

    const upd = await c.query(
      `UPDATE office_transfers SET status='recu', received_caisse_id=$2, sent_tx_id=$3, received_tx_id=$4,
              received_by=$5, received_at=now(), forced=$6, note=COALESCE($7, note)
        WHERE id=$1 RETURNING *`,
      [id, to.id, txIds.out, txIds.in, admin.id, isShort, note ?? null]
    );
    await writeAudit(c, {
      adminId: admin.id,
      action: isShort ? 'transfer.receive.forced' : 'transfer.receive',
      entity: 'office_transfer', entityId: id,
      details: { toCaisseId: to.id, amount: t.amount, ...(isShort ? { manque: short.toFixed(2) } : {}) },
      ip,
    });
    return upd.rows[0];
  });
}
