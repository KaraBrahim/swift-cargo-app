// Orders (Opération de transport) — one fournisseur shipment China→Algeria that
// groups one or more bons (one bon per passager). Status is derived from bons.
import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { insertChildBon, setBonStatus, deleteBon } from '../bons/bons.service.js';
import { recomputeOrderStatus } from './orderStatus.js';

// An order's stage maps 1:1 to the stage of each of its child bons.
const ORDER_TO_BON = { ouverte: 'cree', en_transit: 'en_transit', arrivee: 'arrive', cloturee: 'regle' };

export async function createOrder({ admin, data, ip }) {
  if (!Array.isArray(data.bons) || data.bons.length === 0) {
    throw errors.validation([{ field: 'bons', message: 'Au moins un bon (un passager) est requis.' }]);
  }
  return withTx(async (c) => {
    const f = await c.query('SELECT 1 FROM people WHERE id=$1 AND active=TRUE AND is_fournisseur', [data.fournisseurId]);
    if (!f.rows.length) throw errors.notFound('Fournisseur introuvable ou inactif.');

    const oRes = await c.query(
      `INSERT INTO orders (fournisseur_id, notes, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [data.fournisseurId, data.notes ?? null, admin.id]
    );
    const order = oRes.rows[0];

    for (const b of data.bons) {
      await insertChildBon(c, { admin, orderId: order.id, fournisseurId: data.fournisseurId, data: b });
    }
    await recomputeOrderStatus(c, order.id);
    await writeAudit(c, { adminId: admin.id, action: 'order.create', entity: 'order', entityId: order.id, details: { reference: order.reference, bons: data.bons.length }, ip });
    return getOrderDetail(order.id, c);
  });
}

// Clickable stepper on the order: move every child bon to the matching stage.
export async function setOrderStatus({ admin, id, target, ip }) {
  const bonTarget = ORDER_TO_BON[target];
  if (!bonTarget) throw errors.validation([{ field: 'target', message: 'Statut invalide.' }]);
  const { rows } = await getPool().query('SELECT id FROM bons WHERE order_id=$1 ORDER BY id', [id]);
  if (!rows.length) throw errors.notFound('Aucun bon pour cet ordre.');
  for (const r of rows) {
    await setBonStatus({ admin, id: r.id, target: bonTarget, note: `Ordre → ${target}`, ip });
  }
  return getOrderDetail(id);
}

// Delete a bon fournisseur: remove each of its child bons (which reverses the
// China reception and the fournisseur's charge), then the order itself. Refused
// while any passager still carries its goods — deleteBon raises that.
export async function deleteOrder({ admin, id, ip }) {
  const order = (await getPool().query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
  if (!order) throw errors.notFound('Bon fournisseur introuvable.');

  const { rows: children } = await getPool().query('SELECT id FROM bons WHERE order_id=$1 ORDER BY id', [id]);
  for (const b of children) await deleteBon({ admin, id: b.id, ip });

  return withTx(async (c) => {
    await c.query('UPDATE person_ledger SET ref_order_id=NULL WHERE ref_order_id=$1', [id]);
    await c.query('UPDATE stock_movements SET ref_order_id=NULL WHERE ref_order_id=$1', [id]);
    await c.query('DELETE FROM orders WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'order.delete', entity: 'order', entityId: id, details: { reference: order.reference }, ip });
    return { deleted: true, reference: order.reference };
  });
}

export async function listOrders({ status, search, fournisseurId, limit = 100 } = {}) {
  const params = [];
  const conds = [];
  if (status) { params.push(status); conds.push(`o.status = $${params.length}`); }
  if (fournisseurId) { params.push(fournisseurId); conds.push(`o.fournisseur_id = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conds.push(`(o.reference ILIKE $${params.length} OR f.name ILIKE $${params.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT o.*, f.name AS fournisseur_name,
            COUNT(b.id) AS bon_count,
            COALESCE(SUM(b.transport_fee),0) AS total_fee,
            COALESCE(SUM(b.loss_total),0) AS total_loss
       FROM orders o
       JOIN people f ON f.id = o.fournisseur_id
       LEFT JOIN bons b ON b.order_id = o.id
       ${where}
      GROUP BY o.id, f.name
      ORDER BY o.created_at DESC, o.id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getOrderDetail(id, client = getPool()) {
  const { rows } = await client.query(
    `SELECT o.*, f.name AS fournisseur_name, f.phone AS fournisseur_phone, a.full_name AS created_by_name, a.role AS created_by_role
       FROM orders o
       JOIN people f ON f.id = o.fournisseur_id
       JOIN admins a ON a.id = o.created_by
      WHERE o.id = $1`,
    [id]
  );
  if (!rows[0]) throw errors.notFound('Ordre introuvable.');

  const { rows: bons } = await client.query(
    `SELECT b.*, p.name AS passager_name,
            (SELECT COUNT(*) FROM bon_lines bl WHERE bl.bon_id = b.id) AS line_count
       FROM bons b LEFT JOIN people p ON p.id = b.passager_id
      WHERE b.order_id = $1 ORDER BY b.id`,
    [id]
  );

  // The goods this bon brought in, and how much of each a passager has taken.
  const { rows: lines } = await client.query(
    `SELECT bl.id AS line_id, bl.designation, bl.measure, bl.unit, bl.unit_price,
            (CASE WHEN bl.measure='poids' THEN bl.weight_kg
                  WHEN bl.measure='cbm'   THEN bl.cbm
                  ELSE bl.quantity END) AS quantity,
            COALESCE((SELECT SUM(CASE WHEN a.measure='poids' THEN a.weight_kg
                                      WHEN a.measure='cbm'   THEN a.cbm
                                      ELSE a.quantity END)
                        FROM bon_lines a WHERE a.source_line_id = bl.id), 0) AS allocated
       FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
      WHERE b.order_id = $1 ORDER BY bl.id`,
    [id]
  );

  // The bons passagers actually carrying this order's goods.
  const { rows: carriers } = await client.query(
    `SELECT DISTINCT cb.id, cb.reference, cb.status, cb.transport_fee, cb.transport_currency,
            cb.passager_payment, p.name AS passager_name
       FROM bon_lines bl
       JOIN bons b ON b.id = bl.bon_id
       JOIN bon_lines cl ON cl.source_line_id = bl.id
       JOIN bons cb ON cb.id = cl.bon_id
       LEFT JOIN people p ON p.id = cb.passager_id
      WHERE b.order_id = $1
      ORDER BY cb.reference`,
    [id]
  );

  const totals = bons.reduce(
    (acc, b) => ({
      transport_fee: acc.transport_fee + Number(b.transport_fee),
      loss_total: acc.loss_total + Number(b.loss_total),
      passager_payment: acc.passager_payment + Number(b.passager_payment ?? 0),
    }),
    { transport_fee: 0, loss_total: 0, passager_payment: 0 }
  );

  const discount = bons.reduce((s, b) => s + Number(b.discount ?? 0), 0);
  const withRemaining = lines.map((l) => ({
    ...l, remaining: Number(l.quantity) - Number(l.allocated),
  }));
  return {
    ...rows[0], bons, carriers, lines: withRemaining,
    totals: {
      ...totals,
      discount,
      billed: Math.max(totals.transport_fee - discount, 0),
      // What is still sitting in China waiting for a passager.
      unallocated: withRemaining.reduce((s, l) => s + Math.max(l.remaining, 0), 0),
    },
  };
}
