// Bons (vouchers). Lifecycle: cree -> en_transit -> arrive -> regle.
// A bon may belong to an order (one bon = one passager's part). Money events
// (fournisseur fee, passager payment) auto-post atomically to the office caisse
// and the person's account.
import { getPool, withTx } from '../../db/pool.js';
import { Decimal, toDecimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';
import { appendEntry, replayPersonLedger } from '../accounts/accounts.service.js';
import { postMovement, replayChain } from '../caisse/caisse.service.js';
import { ensureStockItem, applyMovement } from '../stock/stock.service.js';
import { recomputeOrderStatus } from '../orders/orderStatus.js';

const FORWARD = { cree: 'en_transit', en_transit: 'arrive' };

function parseMoney(v, field, { allowZero = true } = {}) {
  const d = toDecimal(v ?? '0', field);
  if (d.lt(0) || (!allowZero && d.lte(0))) throw errors.invalidAmount(`${field} : montant invalide.`);
  if (d.decimalPlaces() > 2) throw errors.invalidAmount(`${field} : maximum 2 décimales.`);
  if (d.gt(new Decimal('1e13'))) throw errors.invalidAmount(`${field} : valeur trop élevée.`);
  return d.toFixed(2);
}

function parseQty(v, field, { positive = false } = {}) {
  const d = toDecimal(v ?? '0', field);
  if (positive ? d.lte(0) : d.lt(0)) throw errors.invalidAmount(`${field} : quantité invalide.`);
  if (d.decimalPlaces() > 3) throw errors.invalidAmount(`${field} : maximum 3 décimales.`);
  return d.toFixed(3);
}

// Parse the incoming goods lines: one measure per line, article link fields.
// Back-compat: if no 'measure' is sent (older callers), default to 'quantite'.
// The quantity that a line's unit_price multiplies: whichever measure the line
// is quantified by (pieces, kg, or m³).
function lineQty(l) {
  return l.measure === 'poids' ? l.weight_kg : l.measure === 'cbm' ? l.cbm : l.quantity;
}

// Sum of (unit_price × quantity) over lines — the derived transport fee. Pass a
// map of lineId → delivered quantity to bill only what arrived (default: ordered).
function linesTotal(lines, deliveredByQtyFn) {
  return lines.reduce((acc, l) => {
    const qty = deliveredByQtyFn ? deliveredByQtyFn(l) : lineQty(l);
    return acc.plus(new Decimal(l.unit_price).times(qty));
  }, new Decimal(0));
}

function parseLines(data) {
  if (!Array.isArray(data.lines) || data.lines.length === 0) {
    throw errors.validation([{ field: 'lines', message: 'Au moins une ligne de marchandise est requise.' }]);
  }
  const lines = data.lines.map((l) => {
    const measure = ['quantite', 'poids', 'cbm'].includes(l.measure) ? l.measure : 'quantite';
    let quantity = '0', weight_kg = '0', cbm = '0';
    if (measure === 'quantite') quantity = parseQty(l.quantity ?? l.value, 'Quantité', { positive: true });
    else if (measure === 'poids') weight_kg = parseQty(l.weight_kg ?? l.value, 'Poids', { positive: true });
    else cbm = parseQty(l.cbm ?? l.value, 'CBM', { positive: true });
    const unit = measure === 'quantite' ? String(l.unit || 'pièce').trim().slice(0, 20)
      : measure === 'poids' ? 'kg' : 'm³';
    return {
      designation: String(l.designation || '').trim(),
      itemId: l.itemId ? Number(l.itemId) : null,
      createItem: Boolean(l.createItem),
      categoryId: l.categoryId ? Number(l.categoryId) : null,
      measure, quantity, weight_kg, cbm, unit,
      unit_price: parseMoney(l.unitPrice ?? l.unit_price, 'Prix de revient'),
      sourceLineId: l.sourceLineId ? Number(l.sourceLineId) : null,
      note: l.note ?? null,
    };
  });
  // A line names an article directly (bon fournisseur) or draws from a bon
  // fournisseur line (bon passager).
  if (lines.some((l) => !l.designation && !l.itemId && !l.sourceLineId)) {
    throw errors.validation([{ field: 'lines', message: 'Chaque ligne doit avoir une désignation.' }]);
  }
  return lines;
}

// Quantity of a stored bon_line, in whatever measure it uses.
const rowQty = (r) => (r.measure === 'poids' ? r.weight_kg : r.measure === 'cbm' ? r.cbm : r.quantity);

// How much of a bon fournisseur line has already been drawn by bons passagers.
// `exceptBonId` lets a bon being edited ignore its own previous allocation.
async function allocatedOf(c, sourceLineId, exceptBonId = null) {
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(CASE WHEN measure='poids' THEN weight_kg
                              WHEN measure='cbm'   THEN cbm
                              ELSE quantity END), 0) AS allocated
       FROM bon_lines
      WHERE source_line_id = $1 ${exceptBonId ? 'AND bon_id <> $2' : ''}`,
    exceptBonId ? [sourceLineId, exceptBonId] : [sourceLineId]
  );
  return new Decimal(rows[0].allocated);
}

// Bon fournisseur lines that still have goods available to hand to a passager.
// `forBonId` excludes that bon's own allocation, so a bon being edited still
// sees the goods it is currently holding as available to it.
export async function listAllocatable({ fournisseurId, orderId, forBonId } = {}) {
  const params = [];
  const conds = ["b.order_id IS NOT NULL"];
  if (fournisseurId) { params.push(fournisseurId); conds.push(`b.fournisseur_id = $${params.length}`); }
  if (orderId) { params.push(orderId); conds.push(`b.order_id = $${params.length}`); }
  let skip = '';
  if (forBonId) { params.push(forBonId); skip = `AND a.bon_id <> $${params.length}`; }
  const { rows } = await getPool().query(
    `SELECT bl.id AS line_id, bl.item_id, bl.designation, bl.measure, bl.unit,
            bl.unit_price AS sale_price,
            (CASE WHEN bl.measure='poids' THEN bl.weight_kg
                  WHEN bl.measure='cbm'   THEN bl.cbm
                  ELSE bl.quantity END) AS quantity,
            COALESCE((SELECT SUM(CASE WHEN a.measure='poids' THEN a.weight_kg
                                      WHEN a.measure='cbm'   THEN a.cbm
                                      ELSE a.quantity END)
                        FROM bon_lines a WHERE a.source_line_id = bl.id ${skip}), 0) AS allocated,
            b.id AS source_bon_id, b.reference AS source_bon_reference,
            o.id AS order_id, o.reference AS order_reference,
            f.id AS fournisseur_id, f.name AS fournisseur_name
       FROM bon_lines bl
       JOIN bons b   ON b.id = bl.bon_id
       JOIN orders o ON o.id = b.order_id
       JOIN fournisseurs f ON f.id = b.fournisseur_id
      WHERE ${conds.join(' AND ')}
      ORDER BY o.created_at, bl.id`,
    params
  );
  return rows
    .map((r) => ({ ...r, remaining: new Decimal(r.quantity).minus(r.allocated).toFixed(3) }))
    .filter((r) => new Decimal(r.remaining).gt(0));
}

// Resolve each line, insert the bon_line, and — for a bon fournisseur (orderId
// set) — post the China reception movement. A bon passager line instead DRAWS
// from a bon fournisseur line: the article and measure come from the source, and
// the quantity taken may not exceed what is still unallocated on it.
async function insertResolvedLines(c, { bon, lines, orderId, adminId }) {
  for (const l of lines) {
    let itemId = null;
    let designation = l.designation;
    let sourceLineId = null;

    if (l.sourceLineId) {
      // Lock the source line so two bons cannot over-draw it concurrently.
      const src = (await c.query('SELECT * FROM bon_lines WHERE id=$1 FOR UPDATE', [l.sourceLineId])).rows[0];
      if (!src) throw errors.notFound('Ligne de bon fournisseur introuvable.');
      const srcBon = (await c.query('SELECT order_id, fournisseur_id FROM bons WHERE id=$1', [src.bon_id])).rows[0];
      if (!srcBon || srcBon.order_id == null) {
        throw errors.validation([{ field: 'lines', message: 'La source doit être une ligne de bon fournisseur.' }]);
      }
      if (srcBon.fournisseur_id !== bon.fournisseur_id) {
        throw errors.validation([{ field: 'lines', message: 'La marchandise appartient à un autre fournisseur.' }]);
      }
      if (src.measure !== l.measure) {
        throw errors.validation([{ field: 'lines', message: `« ${src.designation} » se mesure en ${src.measure}.` }]);
      }
      const want = new Decimal(l.measure === 'poids' ? l.weight_kg : l.measure === 'cbm' ? l.cbm : l.quantity);
      const remaining = new Decimal(rowQty(src)).minus(await allocatedOf(c, src.id, bon.id));
      if (want.gt(remaining)) {
        throw errors.conflict(`Quantité indisponible pour « ${src.designation} » : il reste ${remaining.toFixed(3)}, demandé ${want.toFixed(3)}.`);
      }
      itemId = src.item_id;
      designation = src.designation;
      sourceLineId = src.id;
    } else if (l.itemId) {
      const it = await c.query('SELECT id, name FROM stock_items WHERE id=$1 AND active=TRUE', [l.itemId]);
      if (!it.rows.length) throw errors.notFound('Article introuvable ou inactif.');
      itemId = it.rows[0].id;
      designation = it.rows[0].name;
    } else if ((l.createItem || orderId) && designation) {
      itemId = await ensureStockItem(c, { name: designation, categoryId: l.categoryId, adminId });
    }

    await c.query(
      `INSERT INTO bon_lines (bon_id, item_id, source_line_id, designation, measure, quantity, unit, weight_kg, cbm, unit_price, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [bon.id, itemId, sourceLineId, designation, l.measure, l.quantity, l.unit, l.weight_kg, l.cbm, l.unit_price, l.note]
    );
    if (orderId && itemId) {
      await applyMovement(c, {
        itemId, office: 'china', dQ: l.quantity, dW: l.weight_kg, dC: l.cbm,
        reason: 'reception', refOrderId: orderId, refBonId: bon.id, adminId,
      });
    }
  }
}

// The bons fournisseurs (via their orders) that a bon passager draws from.
async function sourceOrderIds(c, bonId) {
  const { rows } = await c.query(
    `SELECT DISTINCT sb.order_id
       FROM bon_lines l
       JOIN bon_lines src ON src.id = l.source_line_id
       JOIN bons sb ON sb.id = src.bon_id
      WHERE l.bon_id = $1 AND sb.order_id IS NOT NULL`,
    [bonId]
  );
  return rows.map((r) => r.order_id);
}

// Refresh every order affected by a bon: its own (bon fournisseur) and the ones
// whose goods it carries (bon passager).
async function recomputeAffectedOrders(c, bon) {
  const ids = new Set([...(await sourceOrderIds(c, bon.id)), bon.order_id].filter(Boolean));
  for (const oid of ids) await recomputeOrderStatus(c, oid);
}

// Bill the fournisseur for a bon fournisseur: the sale total as a debt, and the
// remise (if any) as a credit against it.
async function postFournisseurCharge(c, { bon, fournisseurId, currency, fee, discount, orderId, adminId }) {
  if (new Decimal(fee).gt(0)) {
    await appendEntry(c, {
      personType: 'fournisseur', personId: fournisseurId, currency,
      amount: new Decimal(fee).negated().toFixed(2), type: 'transport_fee',
      refOrderId: orderId, refBonId: bon.id, adminId, note: `Frais transport ${bon.reference}`,
    });
  }
  if (new Decimal(discount).gt(0)) {
    await appendEntry(c, {
      personType: 'fournisseur', personId: fournisseurId, currency,
      amount: new Decimal(discount).toFixed(2), type: 'adjustment',
      refOrderId: orderId, refBonId: bon.id, adminId, note: `Remise ${bon.reference}`,
    });
  }
}

// Insert a bon (+ lines + history + fournisseur fee charge) inside a caller's tx.
// Used by createBon (standalone) and by orders.createOrder (child bons). Does NOT
// recompute order status — the caller does that once after all inserts.
export async function insertChildBon(c, { admin, orderId = null, fournisseurId, data }) {
  const transportCurrency = (data.transportCurrency || 'DZD').toUpperCase();
  const lines = parseLines(data);
  // Derived from the lines: Σ(prix unitaire × quantité). On a bon FOURNISSEUR
  // that is the SALE total (what the fournisseur owes); on a bon PASSAGER it is
  // the COST total (what the passager will be paid).
  const transportFee = linesTotal(lines).toFixed(2);
  const discount = parseMoney(data.discount, 'Remise');

  const f = await c.query('SELECT 1 FROM fournisseurs WHERE id=$1 AND active=TRUE', [fournisseurId]);
  if (!f.rows.length) throw errors.notFound('Fournisseur introuvable ou inactif.');
  if (data.passagerId) {
    const p = await c.query('SELECT 1 FROM passagers WHERE id=$1 AND active=TRUE', [data.passagerId]);
    if (!p.rows.length) throw errors.notFound('Passager introuvable ou inactif.');
  }
  const cur = await c.query('SELECT 1 FROM currencies WHERE code=$1 AND active=TRUE', [transportCurrency]);
  if (!cur.rows.length) throw errors.notFound('Devise de transport inconnue.');

  const bonRes = await c.query(
    `INSERT INTO bons (order_id, fournisseur_id, passager_id, transport_currency, transport_fee, discount, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [orderId, fournisseurId, data.passagerId ?? null, transportCurrency, transportFee, discount, data.notes ?? null, admin.id]
  );
  const bon = bonRes.rows[0];

  await insertResolvedLines(c, { bon, lines, orderId, adminId: admin.id });
  await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [bon.id, 'cree', admin.id, 'Création']);

  // Only a bon FOURNISSEUR bills the fournisseur — once, at reception, for the
  // sale total. A bon passager moves the same goods and must NOT bill them again;
  // it books what we owe the PASSAGER at settlement instead.
  if (orderId) await postFournisseurCharge(c, { bon, fournisseurId, currency: transportCurrency, fee: transportFee, discount, orderId, adminId: admin.id });

  await writeAudit(c, { adminId: admin.id, action: 'bon.create', entity: 'bon', entityId: bon.id, details: { reference: bon.reference, order_id: orderId }, ip: null });
  return bon;
}

export async function createBon({ admin, data, ip }) {
  return withTx(async (c) => {
    const bon = await insertChildBon(c, { admin, orderId: null, fournisseurId: data.fournisseurId, data });
    await writeAudit(c, { adminId: admin.id, action: 'bon.create.standalone', entity: 'bon', entityId: bon.id, details: { reference: bon.reference }, ip });
    return getBonDetail(bon.id, c);
  });
}

// Full edit of a bon while it is still « Créé » — before any goods have moved or
// the passager has been paid. Replaces the goods lines, transport fee/currency,
// and (for a bon passager) the passager. Any fournisseur reception stock and the
// fournisseur fee charge from the old version are reversed, then re-applied.
export async function updateBon({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    if (bon.status !== 'cree') throw errors.conflict('Seul un bon au statut « Créé » peut être modifié.');

    const newCur = (data.transportCurrency || bon.transport_currency).toUpperCase();
    const cur = await c.query('SELECT 1 FROM currencies WHERE code=$1 AND active=TRUE', [newCur]);
    if (!cur.rows.length) throw errors.notFound('Devise de transport inconnue.');
    let newPassagerId = bon.passager_id;
    if ('passagerId' in data) {
      newPassagerId = data.passagerId ? Number(data.passagerId) : null;
      if (newPassagerId) {
        const p = await c.query('SELECT 1 FROM passagers WHERE id=$1 AND active=TRUE', [newPassagerId]);
        if (!p.rows.length) throw errors.notFound('Passager introuvable ou inactif.');
      }
    }
    const lines = parseLines(data);
    // Fee is derived from the (possibly changed) lines.
    const newFee = linesTotal(lines).toFixed(2);
    const newDiscount = 'discount' in data ? parseMoney(data.discount, 'Remise') : bon.discount;

    // Reverse the OLD fournisseur reception (bon fournisseur only).
    if (bon.order_id != null) {
      const { rows: old } = await c.query('SELECT item_id, quantity, weight_kg, cbm FROM bon_lines WHERE bon_id=$1 AND item_id IS NOT NULL', [id]);
      for (const l of old) {
        await applyMovement(c, {
          itemId: l.item_id, office: 'china',
          dQ: new Decimal(l.quantity).negated().toFixed(3),
          dW: new Decimal(l.weight_kg).negated().toFixed(3),
          dC: new Decimal(l.cbm).negated().toFixed(4),
          reason: 'ajustement', refBonId: id, adminId: admin.id, note: `Annulation réception ${bon.reference} (modification)`,
        });
      }
    }
    // Reverse the OLD fournisseur charge + remise (bon fournisseur only — a bon
    // passager never bills the fournisseur).
    if (bon.order_id != null) {
      if (new Decimal(bon.transport_fee).gt(0)) {
        await appendEntry(c, {
          personType: 'fournisseur', personId: bon.fournisseur_id, currency: bon.transport_currency,
          amount: new Decimal(bon.transport_fee).toFixed(2), type: 'adjustment',
          refOrderId: bon.order_id, refBonId: id, adminId: admin.id, note: `Annulation frais ${bon.reference} (modification)`,
        });
      }
      if (new Decimal(bon.discount).gt(0)) {
        await appendEntry(c, {
          personType: 'fournisseur', personId: bon.fournisseur_id, currency: bon.transport_currency,
          amount: new Decimal(bon.discount).negated().toFixed(2), type: 'adjustment',
          refOrderId: bon.order_id, refBonId: id, adminId: admin.id, note: `Annulation remise ${bon.reference} (modification)`,
        });
      }
    }

    // Replace lines, update header, re-apply reception.
    // Orders that were fed by the OLD lines must be re-evaluated too, since the
    // goods they had allocated are being released.
    const touched = await sourceOrderIds(c, id);
    await c.query('DELETE FROM bon_lines WHERE bon_id=$1', [id]);
    await c.query(
      'UPDATE bons SET transport_currency=$2, transport_fee=$3, discount=$4, passager_id=$5, notes=$6 WHERE id=$1',
      [id, newCur, newFee, newDiscount, newPassagerId, data.notes ?? bon.notes]
    );
    const bon2 = (await c.query('SELECT * FROM bons WHERE id=$1', [id])).rows[0];
    await insertResolvedLines(c, { bon: bon2, lines, orderId: bon.order_id, adminId: admin.id });

    if (bon.order_id != null) {
      await postFournisseurCharge(c, { bon, fournisseurId: bon.fournisseur_id, currency: newCur, fee: newFee, discount: newDiscount, orderId: bon.order_id, adminId: admin.id });
    }

    await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [id, 'cree', admin.id, 'Modification']);
    for (const oid of new Set([...touched, ...(await sourceOrderIds(c, id)), bon.order_id].filter(Boolean))) {
      await recomputeOrderStatus(c, oid);
    }
    await writeAudit(c, { adminId: admin.id, action: 'bon.update', entity: 'bon', entityId: id, details: { reference: bon.reference }, ip });
    return getBonDetail(id, c);
  });
}

// Cancel a payment already made on a bon: the money goes back out of (or into)
// the caisse and the person's account returns to what it owed. Both sides are
// removed together — the caisse ledger deliberately refuses to delete these rows
// on its own, because doing so there would leave the person's account untouched.
export async function cancelBonPayment({ admin, id, entryId, ip }) {
  return withTx(async (c) => {
    const bon = (await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');

    const entry = (await c.query(
      `SELECT * FROM person_ledger WHERE id=$1 AND ref_bon_id=$2 FOR UPDATE`, [entryId, id]
    )).rows[0];
    if (!entry) throw errors.notFound('Paiement introuvable sur ce bon.');
    if (!['fee_payment', 'passager_payment'].includes(entry.type)) {
      throw errors.conflict('Seuls les encaissements et paiements peuvent être annulés ici.');
    }

    // person_ledger.caisse_tx_id references transactions, so the ledger entry has
    // to go first or the foreign key blocks the delete. Same sequence as the
    // generic payment delete used from the profile and caisse screens.
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
      adminId: admin.id, action: 'bon.payment.cancel', entity: 'bon', entityId: id,
      details: { entryId, type: entry.type, amount: entry.amount, currency: entry.currency_code }, ip,
    });
    return getBonDetail(id, c);
  });
}

// Delete a bon entirely. Rather than unpicking each side-effect by hand, the bon
// is first rewound to « Créé » — which reverses stock legs, the passager's due
// and the fournisseur's credits through the same paths the stepper uses — and
// only then are its rows removed. Cash that actually moved through a caisse
// blocks the rewind, so a paid bon can never silently vanish.
export async function deleteBon({ admin, id, ip }) {
  const bon = (await getPool().query('SELECT * FROM bons WHERE id=$1', [id])).rows[0];
  if (!bon) throw errors.notFound('Bon introuvable.');

  if (bon.status !== 'cree') await setBonStatus({ admin, id, target: 'cree', note: 'Avant suppression', ip });

  return withTx(async (c) => {
    const fresh = (await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!fresh) throw errors.notFound('Bon introuvable.');

    // A bon fournisseur cannot go while passagers still hold its goods.
    if (fresh.order_id != null) {
      const held = await c.query(
        `SELECT COUNT(*)::int AS n FROM bon_lines a
           JOIN bon_lines src ON src.id = a.source_line_id
          WHERE src.bon_id = $1`, [id]
      );
      if (held.rows[0].n > 0) {
        throw errors.conflict('Suppression impossible : des bons passagers transportent déjà ces marchandises. Supprimez-les d’abord.');
      }
      // Undo the China reception and the fournisseur's charge/remise.
      const { rows: lines } = await c.query('SELECT item_id, quantity, weight_kg, cbm FROM bon_lines WHERE bon_id=$1 AND item_id IS NOT NULL', [id]);
      for (const l of lines) {
        await applyMovement(c, {
          itemId: l.item_id, office: 'china',
          dQ: new Decimal(l.quantity).negated().toFixed(3),
          dW: new Decimal(l.weight_kg).negated().toFixed(3),
          dC: new Decimal(l.cbm).negated().toFixed(4),
          reason: 'ajustement', refBonId: id, adminId: admin.id, note: `Suppression ${fresh.reference}`,
        });
      }
      if (new Decimal(fresh.transport_fee).gt(0)) {
        await appendEntry(c, {
          personType: 'fournisseur', personId: fresh.fournisseur_id, currency: fresh.transport_currency,
          amount: new Decimal(fresh.transport_fee).toFixed(2), type: 'adjustment',
          refBonId: id, adminId: admin.id, note: `Annulation frais ${fresh.reference} (suppression)`,
        });
      }
      if (new Decimal(fresh.discount).gt(0)) {
        await appendEntry(c, {
          personType: 'fournisseur', personId: fresh.fournisseur_id, currency: fresh.transport_currency,
          amount: new Decimal(fresh.discount).negated().toFixed(2), type: 'adjustment',
          refBonId: id, adminId: admin.id, note: `Annulation remise ${fresh.reference} (suppression)`,
        });
      }
    }

    const touched = await sourceOrderIds(c, id);
    // Detach ledger/stock history so the audit trail survives the row removal.
    await c.query('UPDATE person_ledger SET ref_bon_id=NULL WHERE ref_bon_id=$1', [id]);
    await c.query('UPDATE stock_movements SET ref_bon_id=NULL WHERE ref_bon_id=$1', [id]);
    await c.query('DELETE FROM bon_status_history WHERE bon_id=$1', [id]);
    await c.query('DELETE FROM bon_lines WHERE bon_id=$1', [id]);
    await c.query('DELETE FROM bons WHERE id=$1', [id]);

    for (const oid of new Set([...touched, fresh.order_id].filter(Boolean))) {
      await recomputeOrderStatus(c, oid);
    }
    await writeAudit(c, { adminId: admin.id, action: 'bon.delete', entity: 'bon', entityId: id, details: { reference: fresh.reference }, ip });
    return { deleted: true, reference: fresh.reference };
  });
}

// ── Queries ───────────────────────────────────────────────────────────
export async function listBons({ status, search, fournisseurId, passagerId, orderId, limit = 100 } = {}) {
  const params = [];
  const conds = [];
  if (status) { params.push(status); conds.push(`b.status = $${params.length}`); }
  if (fournisseurId) { params.push(fournisseurId); conds.push(`b.fournisseur_id = $${params.length}`); }
  if (passagerId) { params.push(passagerId); conds.push(`b.passager_id = $${params.length}`); }
  if (orderId) { params.push(orderId); conds.push(`b.order_id = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conds.push(`(b.reference ILIKE $${params.length} OR f.name ILIKE $${params.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT b.*, f.name AS fournisseur_name, p.full_name AS passager_name, o.reference AS order_reference
       FROM bons b
       JOIN fournisseurs f ON f.id = b.fournisseur_id
       LEFT JOIN passagers p ON p.id = b.passager_id
       LEFT JOIN orders o ON o.id = b.order_id
       ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getBonDetail(id, client = getPool()) {
  const { rows } = await client.query(
    `SELECT b.*, f.name AS fournisseur_name, f.phone AS fournisseur_phone,
            p.full_name AS passager_name, p.phone AS passager_phone, p.type AS passager_type,
            a.full_name AS created_by_name, o.reference AS order_reference
       FROM bons b
       JOIN fournisseurs f ON f.id = b.fournisseur_id
       LEFT JOIN passagers p ON p.id = b.passager_id
       LEFT JOIN orders o ON o.id = b.order_id
       JOIN admins a ON a.id = b.created_by
      WHERE b.id = $1`,
    [id]
  );
  if (!rows[0]) throw errors.notFound('Bon introuvable.');
  // Cash actually collected/paid for this bon, so the UI can show it — and let
  // the user cancel it, which is the only way to unblock a rewind or a delete.
  const payments = await client.query(
    `SELECT pl.id, pl.person_type, pl.person_id, pl.type, pl.amount, pl.currency_code,
            pl.caisse_tx_id, pl.created_at, pl.note,
            a.full_name AS admin_name, t.caisse_id, c.label AS caisse_label,
            COALESCE(f.name, p.full_name) AS person_name
       FROM person_ledger pl
       JOIN admins a ON a.id = pl.admin_id
       LEFT JOIN transactions t ON t.id = pl.caisse_tx_id
       LEFT JOIN caisses c ON c.id = t.caisse_id
       LEFT JOIN fournisseurs f ON pl.person_type='fournisseur' AND f.id = pl.person_id
       LEFT JOIN passagers p    ON pl.person_type='passager'    AND p.id = pl.person_id
      WHERE pl.ref_bon_id = $1 AND pl.type IN ('fee_payment','passager_payment')
      ORDER BY pl.created_at DESC, pl.id DESC`,
    [id]
  );
  const [lines, history] = await Promise.all([
    // Carry the source line's sale price so the UI can show the margin.
    client.query(
      `SELECT bl.*, src.unit_price AS source_unit_price, sb.reference AS source_bon_reference,
              so.id AS source_order_id, so.reference AS source_order_reference
         FROM bon_lines bl
         LEFT JOIN bon_lines src ON src.id = bl.source_line_id
         LEFT JOIN bons sb   ON sb.id = src.bon_id
         LEFT JOIN orders so ON so.id = sb.order_id
        WHERE bl.bon_id=$1 ORDER BY bl.id`, [id]),
    client.query('SELECT h.*, a.full_name AS admin_name FROM bon_status_history h JOIN admins a ON a.id=h.admin_id WHERE h.bon_id=$1 ORDER BY h.created_at, h.id', [id]),
  ]);
  return { ...rows[0], lines: lines.rows, history: history.rows, payments: payments.rows };
}

// ── Status transitions ────────────────────────────────────────────────
// Move a passager bon's stocked goods as it travels: on departure the goods
// leave China (they become "in transit", in neither office); on arrival they
// enter Algeria. Only applies to passager bons (order_id NULL) and only to lines
// linked to a catalogue article — a fournisseur bon's own reception is handled
// at creation, and free-text lines carry no stock.
async function shipLinesStock(c, { bon, direction, adminId }) {
  const { rows: lines } = await c.query(
    'SELECT item_id, measure, quantity, weight_kg, cbm FROM bon_lines WHERE bon_id=$1 AND item_id IS NOT NULL',
    [bon.id]
  );
  for (const l of lines) {
    if (direction === 'depart') {
      const { rows } = await c.query(
        'SELECT quantity, weight_kg, cbm FROM stock_levels WHERE item_id=$1 AND office=$2', [l.item_id, 'china']
      );
      const lvl = rows[0] || { quantity: '0', weight_kg: '0', cbm: '0' };
      const need = l.measure === 'poids' ? l.weight_kg : l.measure === 'cbm' ? l.cbm : l.quantity;
      const have = l.measure === 'poids' ? lvl.weight_kg : l.measure === 'cbm' ? lvl.cbm : lvl.quantity;
      if (new Decimal(have).lt(need)) {
        const nm = (await c.query('SELECT name FROM stock_items WHERE id=$1', [l.item_id])).rows[0]?.name || 'article';
        throw errors.conflict(`Stock Chine insuffisant pour « ${nm} » (disponible ${have}, requis ${need}).`);
      }
      await applyMovement(c, {
        itemId: l.item_id, office: 'china',
        dQ: new Decimal(l.quantity).negated().toFixed(3),
        dW: new Decimal(l.weight_kg).negated().toFixed(3),
        dC: new Decimal(l.cbm).negated().toFixed(4),
        reason: 'depart', refBonId: bon.id, adminId,
      });
    } else {
      await applyMovement(c, {
        itemId: l.item_id, office: 'algeria',
        dQ: l.quantity, dW: l.weight_kg, dC: l.cbm,
        reason: 'arrivee', refBonId: bon.id, adminId,
      });
    }
  }
}

export async function advanceStatus({ admin, id, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    const next = FORWARD[bon.status];
    if (!next) throw errors.conflict(`Transition impossible depuis le statut « ${bon.status} ».`);

    // Passager bons carry goods between the two stocks.
    if (bon.order_id == null) {
      if (next === 'en_transit') await shipLinesStock(c, { bon, direction: 'depart', adminId: admin.id });
      else if (next === 'arrive') await shipLinesStock(c, { bon, direction: 'arrivee', adminId: admin.id });
    }

    const extra = next === 'arrive' ? ', arrived_at = now()' : '';
    await c.query(`UPDATE bons SET status=$2 ${extra} WHERE id=$1`, [id, next]);
    await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [id, next, admin.id, note ?? null]);
    await recomputeAffectedOrders(c, bon);
    await writeAudit(c, { adminId: admin.id, action: 'bon.status', entity: 'bon', entityId: id, details: { from: bon.status, to: next }, ip });
    return getBonDetail(id, c);
  });
}

// ── Reconciliation (at "arrive") ──────────────────────────────────────
// The user records, per line, the quantity that could NOT be delivered to the
// desk ("manquant"). Delivered = ordered − missing; the missing value at the
// line's prix de revient (unit_price × missing) is the loss. The delivered total
// is what the passager is paid and the fournisseur is billed.
export async function reconcile({ admin, id, lines, ip }) {
  if (!Array.isArray(lines)) throw errors.validation([{ field: 'lines', message: 'Lignes requises.' }]);
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    if (bon.status !== 'arrive') throw errors.conflict('La réconciliation n\'est possible qu\'au statut « arrivé ».');

    const { rows: dbLines } = await c.query('SELECT * FROM bon_lines WHERE bon_id=$1', [id]);
    const byId = new Map(dbLines.map((r) => [String(r.id), r]));

    let lossTotal = new Decimal(0);
    for (const l of lines) {
      const dl = byId.get(String(l.lineId));
      if (!dl) throw errors.validation([{ field: 'lineId', message: `Ligne ${l.lineId} inconnue.` }]);
      const qty = new Decimal(lineQty(dl));
      // Prefer an explicit missing quantity; fall back to a delivered quantity.
      let missing;
      if (l.missing != null && l.missing !== '') missing = new Decimal(parseQty(l.missing, 'Quantité manquante'));
      else if (l.receivedQuantity != null && l.receivedQuantity !== '') missing = Decimal.max(qty.minus(parseQty(l.receivedQuantity, 'Quantité reçue')), 0);
      else missing = new Decimal(0);
      if (missing.gt(qty)) throw errors.invalidAmount(`Le manquant ne peut pas dépasser la quantité (${qty.toFixed(3)}).`);
      const delivered = qty.minus(missing);
      const lossValue = new Decimal(dl.unit_price).times(missing);
      lossTotal = lossTotal.plus(lossValue);
      await c.query(
        'UPDATE bon_lines SET received_quantity=$2, loss_value=$3, responsible=$4 WHERE id=$1 AND bon_id=$5',
        [dl.id, delivered.toFixed(3), lossValue.toFixed(2), l.responsible ?? null, id]
      );
    }
    await c.query('UPDATE bons SET loss_total=$2 WHERE id=$1', [id, lossTotal.toFixed(2)]);
    await writeAudit(c, { adminId: admin.id, action: 'bon.reconcile', entity: 'bon', entityId: id, details: { loss_total: lossTotal.toFixed(2) }, ip });
    return getBonDetail(id, c);
  });
}

// ── Settlement helpers (shared by settle() and the status stepper) ─────
// What the missing goods are worth to the FOURNISSEUR — i.e. at the SALE price
// of the bon fournisseur line they came from, not the cost price we pay the
// passager. Grouped by source bon, since a bon passager may carry goods billed
// in different currencies.
async function missingSaleCredits(c, bonId) {
  const qty = "(CASE WHEN l.measure='poids' THEN l.weight_kg WHEN l.measure='cbm' THEN l.cbm ELSE l.quantity END)";
  const { rows } = await c.query(
    `SELECT sb.fournisseur_id, sb.transport_currency AS currency, sb.order_id,
            SUM(src.unit_price * GREATEST(${qty} - COALESCE(l.received_quantity, ${qty}), 0)) AS credit
       FROM bon_lines l
       JOIN bon_lines src ON src.id = l.source_line_id
       JOIN bons sb ON sb.id = src.bon_id
      WHERE l.bon_id = $1
      GROUP BY sb.fournisseur_id, sb.transport_currency, sb.order_id`,
    [bonId]
  );
  return rows.filter((r) => new Decimal(r.credit).gt(0));
}

// Book a bon as réglé: pay the passager the delivered total (cost price), and
// credit the fournisseur for the undelivered part at the sale price they were
// billed at reception — they only pay for what actually arrived.
async function bookSettlement(c, bon, admin, payment, note) {
  await c.query('UPDATE bons SET status=$2, settled_at=now(), passager_payment=$3 WHERE id=$1', [bon.id, 'regle', payment]);
  await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [bon.id, 'regle', admin.id, note ?? 'Réglé']);
  if (bon.passager_id && new Decimal(payment).gt(0)) {
    await appendEntry(c, {
      personType: 'passager', personId: bon.passager_id, currency: bon.transport_currency,
      amount: payment, type: 'passager_due', refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Dû transport ${bon.reference}`,
    });
  }
  for (const cr of await missingSaleCredits(c, bon.id)) {
    await appendEntry(c, {
      personType: 'fournisseur', personId: cr.fournisseur_id, currency: cr.currency,
      amount: new Decimal(cr.credit).toFixed(2), type: 'adjustment', refOrderId: cr.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Avoir manquants ${bon.reference}`,
    });
  }
}

// Undo bookSettlement (backward from « Réglé »). Blocked once real cash has moved
// through a caisse for this bon.
async function reverseSettlement(c, bon, admin, note) {
  const { rows } = await c.query(
    `SELECT 1 FROM person_ledger WHERE ref_bon_id=$1 AND type IN ('fee_payment','passager_payment') LIMIT 1`, [bon.id]
  );
  if (rows.length) {
    throw errors.conflict('Retour impossible : de l’argent a déjà été encaissé ou payé pour ce bon. Annulez ces paiements dans la section « Argent » du bon, puis réessayez.');
  }
  if (bon.passager_id && bon.passager_payment && new Decimal(bon.passager_payment).gt(0)) {
    await appendEntry(c, {
      personType: 'passager', personId: bon.passager_id, currency: bon.transport_currency,
      amount: new Decimal(bon.passager_payment).negated().toFixed(2), type: 'adjustment', refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Annulation dû ${bon.reference}`,
    });
  }
  for (const cr of await missingSaleCredits(c, bon.id)) {
    await appendEntry(c, {
      personType: 'fournisseur', personId: cr.fournisseur_id, currency: cr.currency,
      amount: new Decimal(cr.credit).negated().toFixed(2), type: 'adjustment', refOrderId: cr.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Annulation avoir manquants ${bon.reference}`,
    });
  }
  await c.query('UPDATE bons SET passager_payment=NULL, settled_at=NULL WHERE id=$1', [bon.id]);
}

// Reverse a stock leg when stepping a passager bon backward. Undoing a departure
// returns goods to China (+); undoing an arrival removes them from Algeria (−).
async function reverseShip(c, bon, leg, adminId) {
  const { rows: lines } = await c.query('SELECT item_id, quantity, weight_kg, cbm FROM bon_lines WHERE bon_id=$1 AND item_id IS NOT NULL', [bon.id]);
  for (const l of lines) {
    if (leg === 'depart') {
      await applyMovement(c, { itemId: l.item_id, office: 'china', dQ: l.quantity, dW: l.weight_kg, dC: l.cbm, reason: 'ajustement', refBonId: bon.id, adminId, note: `Retour en Chine ${bon.reference}` });
    } else {
      await applyMovement(c, {
        itemId: l.item_id, office: 'algeria',
        dQ: new Decimal(l.quantity).negated().toFixed(3),
        dW: new Decimal(l.weight_kg).negated().toFixed(3),
        dC: new Decimal(l.cbm).negated().toFixed(4),
        reason: 'ajustement', refBonId: bon.id, adminId, note: `Annulation arrivée ${bon.reference}`,
      });
    }
  }
}

export async function settle({ admin, id, passagerPayment, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    if (bon.status !== 'arrive') throw errors.conflict('Le règlement n\'est possible qu\'au statut « arrivé ».');

    const delivered = Decimal.max(new Decimal(bon.transport_fee).minus(bon.loss_total), 0).toFixed(2);
    const payment = passagerPayment != null && passagerPayment !== '' ? parseMoney(passagerPayment, 'Paiement passager') : delivered;

    await bookSettlement(c, bon, admin, payment, note);
    await recomputeAffectedOrders(c, bon);
    await writeAudit(c, { adminId: admin.id, action: 'bon.settle', entity: 'bon', entityId: id, details: { passager_payment: payment, loss_total: bon.loss_total }, ip });
    return getBonDetail(id, c);
  });
}

// ── Direct status jumps (clickable stepper) ───────────────────────────
// Move a bon to any target stage, forward or backward, replaying/rewinding each
// single step's side-effects (stock legs, settlement). Backward steps reverse
// stock and money and reset reconciliation when leaving « arrivé ».
const STAGES = ['cree', 'en_transit', 'arrive', 'regle'];

export async function setBonStatus({ admin, id, target, note, ip }) {
  if (!STAGES.includes(target)) throw errors.validation([{ field: 'target', message: 'Statut invalide.' }]);
  return withTx(async (c) => {
    let bon = (await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    const to = STAGES.indexOf(target);
    let cur = STAGES.indexOf(bon.status);
    const isPassagerBon = bon.order_id == null;

    while (cur !== to) {
      if (cur < to) {
        const next = STAGES[cur + 1];
        if (isPassagerBon && next === 'en_transit') await shipLinesStock(c, { bon, direction: 'depart', adminId: admin.id });
        else if (isPassagerBon && next === 'arrive') await shipLinesStock(c, { bon, direction: 'arrivee', adminId: admin.id });
        if (next === 'regle') {
          const payment = Decimal.max(new Decimal(bon.transport_fee).minus(bon.loss_total), 0).toFixed(2);
          await bookSettlement(c, bon, admin, payment, note ?? 'Changement de statut');
        } else {
          const extra = next === 'arrive' ? ', arrived_at=now()' : '';
          await c.query(`UPDATE bons SET status=$2 ${extra} WHERE id=$1`, [id, next]);
          await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [id, next, admin.id, note ?? 'Changement de statut']);
        }
        cur++;
      } else {
        const leaving = STAGES[cur];
        const prev = STAGES[cur - 1];
        if (leaving === 'regle') {
          await reverseSettlement(c, bon, admin, note);
        } else if (leaving === 'arrive') {
          if (isPassagerBon) await reverseShip(c, bon, 'arrivee', admin.id);
          await c.query('UPDATE bons SET arrived_at=NULL, loss_total=0 WHERE id=$1', [id]);
          await c.query('UPDATE bon_lines SET received_quantity=NULL, loss_value=0, responsible=NULL WHERE bon_id=$1', [id]);
        } else if (leaving === 'en_transit') {
          if (isPassagerBon) await reverseShip(c, bon, 'depart', admin.id);
        }
        await c.query('UPDATE bons SET status=$2 WHERE id=$1', [id, prev]);
        await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [id, prev, admin.id, note ?? 'Retour en arrière']);
        cur--;
      }
      bon = (await c.query('SELECT * FROM bons WHERE id=$1', [id])).rows[0];
    }

    await recomputeAffectedOrders(c, bon);
    await writeAudit(c, { adminId: admin.id, action: 'bon.status.set', entity: 'bon', entityId: id, details: { to: target }, ip });
    return getBonDetail(id, c);
  });
}

// ── Auto-post money events ─────────────────────────────────────────────
// Fournisseur pays transport fee → cash INTO an office caisse + reduce their debt.
export async function collectFee({ admin, id, caisseId, amount, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    const amt = amount != null && amount !== '' ? parseMoney(amount, 'Montant', { allowZero: false }) : bon.transport_fee;
    if (!(new Decimal(amt).gt(0))) throw errors.invalidAmount('Aucun montant à encaisser.');

    const { txId } = await postMovement(c, {
      caisseId, currency: bon.transport_currency, direction: 'in', amount: amt,
      type: 'order_fee', note: note ?? `Encaissement frais ${bon.reference}`, adminId: admin.id,
    });
    await appendEntry(c, {
      personType: 'fournisseur', personId: bon.fournisseur_id, currency: bon.transport_currency,
      amount: amt, type: 'fee_payment', refOrderId: bon.order_id, refBonId: bon.id,
      caisseTxId: txId, adminId: admin.id, note,
    });
    await writeAudit(c, { adminId: admin.id, action: 'bon.collect_fee', entity: 'bon', entityId: id, details: { amount: amt, caisseId }, ip });
    return getBonDetail(id, c);
  });
}

// Pay the passager → cash OUT of an office caisse + reduce what we owe them.
export async function payPassager({ admin, id, caisseId, amount, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    if (bon.status !== 'regle') throw errors.conflict('Le bon doit être réglé avant de payer le passager.');
    if (!bon.passager_id) throw errors.conflict('Aucun passager sur ce bon.');
    const amt = amount != null && amount !== '' ? parseMoney(amount, 'Montant', { allowZero: false }) : bon.passager_payment;
    if (amt == null || !(new Decimal(amt).gt(0))) throw errors.invalidAmount('Aucun paiement à effectuer.');

    const { txId } = await postMovement(c, {
      caisseId, currency: bon.transport_currency, direction: 'out', amount: amt,
      type: 'passager_payment', note: note ?? `Paiement passager ${bon.reference}`, adminId: admin.id,
    });
    await appendEntry(c, {
      personType: 'passager', personId: bon.passager_id, currency: bon.transport_currency,
      amount: new Decimal(amt).negated().toFixed(2), type: 'passager_payment',
      refOrderId: bon.order_id, refBonId: bon.id, caisseTxId: txId, adminId: admin.id, note,
    });
    await writeAudit(c, { adminId: admin.id, action: 'bon.pay_passager', entity: 'bon', entityId: id, details: { amount: amt, caisseId }, ip });
    return getBonDetail(id, c);
  });
}
