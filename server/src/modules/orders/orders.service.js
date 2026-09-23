// Orders (Opération de transport) — one fournisseur shipment China→Algeria that
// groups one or more bons (one bon per passager). Status is derived from bons.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { insertChildBon, deleteBonTx } from '../bons/bons.service.js';
import { applyMovement } from '../stock/stock.service.js';
import { recomputeOrderStatus, deliverableLines, ARRIVED, QTY } from './orderStatus.js';

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

// ── La remise au fournisseur ──────────────────────────────────────────
// Le dernier trajet de la marchandise : elle sort du bureau d'Alger.
//
// Jamais « tout ou rien ». Les manquants font qu'une partie n'arrive pas, et un
// client prend souvent la moitié aujourd'hui. Chaque appel remet un DELTA par
// ligne, plafonné à ce qui est arrivé et pas encore parti ; l'ordre passe à
// « livrée » quand il ne reste plus rien au bureau, et c'est recomputeOrderStatus
// qui le décide, pas cette fonction.
function parseQty(v, field) {
  const d = new Decimal(String(v ?? '0').trim() || '0');
  if (!d.isFinite() || d.lt(0)) throw errors.invalidAmount(`${field} : quantité invalide.`);
  if (d.decimalPlaces() > 3) throw errors.invalidAmount(`${field} : maximum 3 décimales.`);
  return d;
}

// Le geste lui-même, partagé par les deux portes qui y mènent : le bouton
// « Livrer » d'un bon fournisseur, et le comptoir « Remise à … » qui vide
// plusieurs ordres du même homme en une fois. Une seule copie, parce qu'un
// mouvement de stock écrit à deux endroits finit par être écrit de deux façons.
//
// `allow` dit quelles lignes l'appelant a le droit de toucher — un ordre, ou
// tout ce qui appartient à une personne. Une ligne demandée hors de ce
// périmètre est refusée : sans ce garde, l'écran d'une personne pourrait sortir
// du stock la marchandise de quelqu'un d'autre.
export async function applyDelivery(c, { admin, lines, allow, note }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw errors.validation([{ field: 'lines', message: 'Au moins une ligne à livrer.' }]);
  }
  const ids = lines.map((l) => Number(l.lineId)).filter(Number.isFinite);
  if (!ids.length) throw errors.validation([{ field: 'lines', message: 'Aucune ligne valide.' }]);

  // Verrous AVANT toute lecture de ce qui est livrable : deux remises
  // simultanées liraient toutes les deux « il reste tout », et la seconde
  // sortirait du stock une marchandise déjà partie. Ordres d'abord, lignes
  // ensuite, chacun par id croissant — un ordre de verrouillage identique pour
  // tout le monde est ce qui empêche deux comptoirs de se bloquer l'un l'autre.
  await c.query(
    `SELECT 1 FROM orders WHERE id IN (
       SELECT b.order_id FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE bl.id = ANY($1::bigint[]))
      ORDER BY id FOR UPDATE`,
    [ids]
  );
  await c.query('SELECT 1 FROM bon_lines WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);

  const byId = new Map((await deliverableLines(c, { ...allow, lineIds: ids })).map((l) => [String(l.id), l]));

  const touched = new Set();
  let moved = 0;
  for (const req of lines) {
    const l = byId.get(String(req.lineId));
    if (!l) throw errors.validation([{ field: 'lineId', message: `Ligne ${req.lineId} inconnue ou hors de cette remise.` }]);
    const want = parseQty(req.quantity, `« ${l.designation} »`);
    if (want.isZero()) continue;
    const can = new Decimal(l.deliverable);
    if (want.gt(can)) {
      throw errors.conflict(
        `« ${l.designation} » : il n'y a que ${can.toFixed(3)} ${l.unit} au bureau, demandé ${want.toFixed(3)}.`
      );
    }
    await c.query(
      'UPDATE bon_lines SET delivered_quantity = delivered_quantity + $2 WHERE id = $1',
      [l.id, want.toFixed(3)]
    );
    // Une ligne en texte libre n'a pas d'article : elle enregistre la quantité
    // remise, mais il n'y a aucun niveau de stock à faire bouger.
    if (l.item_id) {
      const neg = want.negated();
      await applyMovement(c, {
        itemId: l.item_id, office: 'algeria',
        dQ: l.measure === 'quantite' ? neg.toFixed(3) : '0',
        dW: l.measure === 'poids' ? neg.toFixed(3) : '0',
        dC: l.measure === 'cbm' ? neg.toFixed(4) : '0',
        reason: 'livraison', refOrderId: l.order_id, refBonId: l.bon_id, adminId: admin.id,
        note: note ?? `Remise au fournisseur ${l.order_reference}`,
      });
    }
    touched.add(l.order_id);
    moved++;
  }
  if (!moved) throw errors.invalidAmount('Aucune quantité à livrer.');

  for (const oid of [...touched].sort((a, b) => a - b)) await recomputeOrderStatus(c, oid);
  return { moved, orders: [...touched] };
}

export async function deliverOrder({ admin, id, lines, ip }) {
  return withTx(async (c) => {
    const order = (await c.query('SELECT reference FROM orders WHERE id=$1', [id])).rows[0];
    if (!order) throw errors.notFound('Bon fournisseur introuvable.');
    const { moved } = await applyDelivery(c, { admin, lines, allow: { orderId: id } });
    await writeAudit(c, {
      adminId: admin.id, action: 'order.deliver', entity: 'order', entityId: id,
      details: { reference: order.reference, lignes: moved }, ip,
    });
    return getOrderDetail(id, c);
  });
}

// Annuler la remise : la marchandise revient au bureau d'Alger. Sans ce chemin,
// une livraison saisie par erreur fausse le stock algérien pour toujours — et
// c'est un stock qu'on compte à la main pour le vérifier.
export async function cancelDelivery({ admin, id, ip }) {
  return withTx(async (c) => {
    const order = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!order) throw errors.notFound('Bon fournisseur introuvable.');

    const { rows } = await c.query(
      `SELECT bl.id, bl.item_id, bl.designation, bl.measure, bl.delivered_quantity, bl.bon_id
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.order_id = $1 AND bl.delivered_quantity > 0
        ORDER BY bl.id FOR UPDATE OF bl`,
      [id]
    );
    if (!rows.length) throw errors.conflict('Aucune livraison à annuler sur ce bon fournisseur.');

    for (const l of rows) {
      const back = new Decimal(l.delivered_quantity);
      if (l.item_id) {
        await applyMovement(c, {
          itemId: l.item_id, office: 'algeria',
          dQ: l.measure === 'quantite' ? back.toFixed(3) : '0',
          dW: l.measure === 'poids' ? back.toFixed(3) : '0',
          dC: l.measure === 'cbm' ? back.toFixed(4) : '0',
          reason: 'ajustement', refOrderId: id, refBonId: l.bon_id, adminId: admin.id,
          note: `Annulation livraison ${order.reference}`,
        });
      }
      await c.query('UPDATE bon_lines SET delivered_quantity = 0 WHERE id = $1', [l.id]);
    }
    // Remis à NULL pour que la prochaine livraison le redate : le garder
    // ferait dire à la fiche qu'elle a été livrée un jour où elle ne l'était pas.
    await c.query('UPDATE orders SET delivered_at = NULL WHERE id = $1', [id]);
    await recomputeOrderStatus(c, id);
    await writeAudit(c, {
      adminId: admin.id, action: 'order.deliver.cancel', entity: 'order', entityId: id,
      details: { reference: order.reference, lignes: rows.length }, ip,
    });
    return getOrderDetail(id, c);
  });
}

// Delete a bon fournisseur: remove each of its child bons (which reverses the
// China reception and the fournisseur's charge), then the order itself. Refused
// while any passager still carries its goods — deleteBon raises that.
export async function deleteOrder({ admin, id, ip }) {
  // Children and parent go together or not at all: a child bon deleted in its
  // own transaction reversed the fournisseur's charge and released the goods,
  // and if the parent then refused to go, that money stayed reversed under an
  // order that still exists.
  return withTx(async (c) => {
    const order = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!order) throw errors.notFound('Bon fournisseur introuvable.');

    const { rows: children } = await c.query('SELECT id FROM bons WHERE order_id=$1 ORDER BY id', [id]);
    for (const b of children) await deleteBonTx(c, { admin, id: b.id, ip });

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

  // Les trois voyages d'une ligne, côte à côte : ce qu'un passager en a pris
  // (`allocated`), ce qui est réellement arrivé au bureau (`arrived`, manquants
  // déduits) et ce que le fournisseur a emporté (`delivered_quantity`).
  const { rows: lines } = await client.query(
    `SELECT bl.id AS line_id, bl.designation, bl.measure, bl.unit, bl.unit_price,
            ${QTY('bl')} AS quantity,
            bl.delivered_quantity,
            ${ARRIVED} AS arrived,
            COALESCE((SELECT SUM(${QTY('a')})
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

  // Ce que le fournisseur a déjà versé sur cet ordre. Sans ce chiffre, la fiche
  // ne peut ni proposer le reste dû ni dire que tout est encaissé.
  const { rows: [cash] } = await client.query(
    `SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM person_ledger
      WHERE ref_order_id = $1 AND type = 'fee_payment'`,
    [id]
  );

  // Exact decimals, not doubles: these three numbers are what the recap prints
  // and what the fournisseur is asked to pay.
  const sum = (field) => bons.reduce((acc, b) => acc.plus(b[field] ?? 0), new Decimal(0));
  const feeTotal = sum('transport_fee');
  const commissionTotal = sum('commission');
  const discountTotal = sum('discount');
  const totals = {
    transport_fee: feeTotal.toFixed(2),
    loss_total: sum('loss_total').toFixed(2),
    passager_payment: sum('passager_payment').toFixed(2),
  };

  const discount = discountTotal.toFixed(2);
  // transport_fee porte deja la commission (voir insertChildBon) : on l'isole
  // ici pour que la fiche puisse afficher les trois lignes du recapitulatif —
  // marchandises, commission, a facturer — sans refaire la somme des lignes.
  const commission = commissionTotal.toFixed(2);
  const withRemaining = lines.map((l) => ({
    ...l,
    remaining: new Decimal(l.quantity).minus(l.allocated).toFixed(3),
    // Ce que le bouton « Livrer » proposera. Calculé ici, à partir des mêmes
    // colonnes que le service : l'écran ne peut donc pas offrir une quantité
    // qui serait refusée à la seconde d'après.
    deliverable: Decimal.max(new Decimal(l.arrived).minus(l.delivered_quantity), 0).toFixed(3),
  }));
  return {
    ...rows[0], bons, carriers, lines: withRemaining,
    totals: {
      ...totals,
      discount,
      commission,
      goods: feeTotal.minus(commissionTotal).toFixed(2),
      billed: Decimal.max(feeTotal.minus(discountTotal), 0).toFixed(2),
      collected: new Decimal(cash.total).toFixed(2),
      due: Decimal.max(feeTotal.minus(discountTotal).minus(cash.total), 0).toFixed(2),
      // What is still sitting in China waiting for a passager.
      unallocated: withRemaining
        .reduce((acc, l) => acc.plus(Decimal.max(l.remaining, 0)), new Decimal(0)).toFixed(3),
    },
  };
}
