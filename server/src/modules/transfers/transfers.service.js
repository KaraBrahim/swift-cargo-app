// Inter-office cash transfers (two legs). Send = OUT at the origin office caisse
// + a pending transfer row. Receive = IN at the destination office caisse +
// mark received. Each leg is written by its own office, so it is conflict-free.
import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { postMovement, replayChain } from '../caisse/caisse.service.js';

export async function listTransfers({ status, limit = 100 } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE t.status = $${params.length}`; }
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT t.*, sc.label AS sent_caisse_label, rc.label AS received_caisse_label,
            sa.full_name AS sent_by_name, ra.full_name AS received_by_name
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

// Origin office sends cash → OUT of its caisse + a pending transfer.
export async function sendTransfer({ admin, fromCaisseId, toOffice, currency, amount, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query("SELECT * FROM caisses WHERE id = $1 AND kind = 'office'", [fromCaisseId]);
    const from = rows[0];
    if (!from) throw errors.notFound('Caisse bureau introuvable.');
    if (!['china', 'algeria'].includes(toOffice)) {
      throw errors.validation([{ field: 'toOffice', message: 'Bureau destination invalide.' }]);
    }
    if (from.office === toOffice) throw errors.conflict('Bureaux source et destination identiques.');

    const { txId } = await postMovement(c, {
      caisseId: fromCaisseId, currency, direction: 'out', amount, type: 'transfer',
      note: note ?? `Transfert vers ${toOffice}`, adminId: admin.id,
    });
    const ins = await c.query(
      `INSERT INTO office_transfers (from_office, to_office, currency_code, amount, sent_caisse_id, sent_tx_id, sent_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [from.office, toOffice, currency, amount, fromCaisseId, txId, admin.id, note ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'transfer.send', entity: 'office_transfer', entityId: ins.rows[0].id, details: { toOffice, currency, amount }, ip });
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

    const next = amount != null && amount !== '' ? String(amount).trim() : t.amount;
    if (!(Number(next) > 0)) throw errors.invalidAmount('Le montant doit être supérieur à zéro.');

    // Re-shape the OUT leg, then replay the caisse's balance chain.
    await c.query('UPDATE transactions SET amount=$2, note=$3 WHERE id=$1', [t.sent_tx_id, next, note ?? t.note]);
    await replayChain(c, t.sent_caisse_id, t.currency_code);
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

    // Remove the OUT leg and put the money back by replaying the chain.
    if (t.sent_tx_id) {
      await c.query('DELETE FROM transactions WHERE id=$1', [t.sent_tx_id]);
      await replayChain(c, t.sent_caisse_id, t.currency_code);
    }
    await c.query('DELETE FROM office_transfers WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'transfer.delete', entity: 'office_transfer', entityId: id, details: { reference: t.reference, amount: t.amount }, ip });
    return { deleted: true, reference: t.reference };
  });
}

// Undo a reception: removes the destination's IN leg and puts the transfer back
// in flight, so it can then be corrected or deleted.
export async function unreceiveTransfer({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id=$1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    if (t.status !== 'recu') throw errors.conflict('Ce transfert n’a pas encore été reçu.');

    if (t.received_tx_id) {
      await c.query('DELETE FROM transactions WHERE id=$1', [t.received_tx_id]);
      await replayChain(c, t.received_caisse_id, t.currency_code);
    }
    const upd = await c.query(
      `UPDATE office_transfers SET status='envoye', received_caisse_id=NULL, received_tx_id=NULL,
              received_by=NULL, received_at=NULL WHERE id=$1 RETURNING *`, [id]
    );
    await writeAudit(c, { adminId: admin.id, action: 'transfer.unreceive', entity: 'office_transfer', entityId: id, ip });
    return upd.rows[0];
  });
}

// Destination office confirms arrival → IN to its caisse + mark received.
export async function receiveTransfer({ admin, id, toCaisseId, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM office_transfers WHERE id = $1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw errors.notFound('Transfert introuvable.');
    if (t.status !== 'envoye') throw errors.conflict('Transfert déjà reçu.');

    const cRes = await c.query("SELECT * FROM caisses WHERE id = $1 AND kind = 'office'", [toCaisseId]);
    const to = cRes.rows[0];
    if (!to) throw errors.notFound('Caisse bureau introuvable.');
    if (to.office !== t.to_office) throw errors.conflict(`La caisse doit être celle du bureau « ${t.to_office} ».`);

    const { txId } = await postMovement(c, {
      caisseId: toCaisseId, currency: t.currency_code, direction: 'in', amount: t.amount, type: 'transfer',
      note: note ?? `Réception transfert ${t.reference}`, adminId: admin.id,
    });
    const upd = await c.query(
      `UPDATE office_transfers SET status='recu', received_caisse_id=$2, received_tx_id=$3,
              received_by=$4, received_at=now(), note=COALESCE($5, note)
        WHERE id=$1 RETURNING *`,
      [id, toCaisseId, txId, admin.id, note ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'transfer.receive', entity: 'office_transfer', entityId: id, details: { toCaisseId, amount: t.amount }, ip });
    return upd.rows[0];
  });
}
