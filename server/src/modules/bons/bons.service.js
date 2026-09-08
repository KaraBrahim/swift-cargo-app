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
      // Ce que le passager doit par unité non livrée. Laissé vide, il prendra la
      // valeur convenue avec le fournisseur (voir insertResolvedLines) : c'est
      // celle-là qu'il faudra rembourser, pas le tarif de portage.
      missing_unit_price: l.missingUnitPrice != null && l.missingUnitPrice !== ''
        ? parseMoney(l.missingUnitPrice, 'Valeur du manquant')
        : null,
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
       JOIN people f ON f.id = b.fournisseur_id
      WHERE ${conds.join(' AND ')}
      ORDER BY f.name, o.created_at, bl.id`,
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
    let sourceUnitPrice = null;

    if (l.sourceLineId) {
      // Lock the source line so two bons cannot over-draw it concurrently.
      const src = (await c.query('SELECT * FROM bon_lines WHERE id=$1 FOR UPDATE', [l.sourceLineId])).rows[0];
      if (!src) throw errors.notFound('Ligne de bon fournisseur introuvable.');
      const srcBon = (await c.query('SELECT order_id, fournisseur_id, transport_currency FROM bons WHERE id=$1', [src.bon_id])).rows[0];
      if (!srcBon || srcBon.order_id == null) {
        throw errors.validation([{ field: 'lines', message: 'La source doit être une ligne de bon fournisseur.' }]);
      }
      // Deliberately no check that the lot belongs to the bon's fournisseur: a
      // passager travels with one suitcase and fills it wherever the goods are
      // ready. What each fournisseur is owed stays right because every credit is
      // computed from the SOURCE line (see missingSaleCredits).
      if (src.measure !== l.measure) {
        throw errors.validation([{ field: 'lines', message: `« ${src.designation} » se mesure en ${src.measure}.` }]);
      }
      const want = new Decimal(l.measure === 'poids' ? l.weight_kg : l.measure === 'cbm' ? l.cbm : l.quantity);
      const remaining = new Decimal(rowQty(src)).minus(await allocatedOf(c, src.id, bon.id));
      if (want.gt(remaining)) {
        throw errors.conflict(`Quantité indisponible pour « ${src.designation} » : il reste ${remaining.toFixed(3)}, demandé ${want.toFixed(3)}.`);
      }
      // Le prix convenu avec le fournisseur est libellé dans SA devise. Si ce
      // bon-ci compte dans une autre, ce nombre ne peut pas servir de valeur du
      // manquant par défaut : il serait soustrait d'un total qui n'est pas dans
      // la même monnaie. On refuse plutôt que de mélanger en silence.
      if (srcBon.transport_currency !== bon.transport_currency && l.missing_unit_price == null) {
        throw errors.validation([{
          field: 'missingUnitPrice',
          message: `« ${src.designation} » a été convenu en ${srcBon.transport_currency} et ce bon compte en `
            + `${bon.transport_currency} : saisissez la valeur du manquant en ${bon.transport_currency}.`,
        }]);
      }
      itemId = src.item_id;
      designation = src.designation;
      sourceLineId = src.id;
      sourceUnitPrice = src.unit_price;
    } else if (l.itemId) {
      const it = await c.query('SELECT id, name FROM stock_items WHERE id=$1 AND active=TRUE', [l.itemId]);
      if (!it.rows.length) throw errors.notFound('Article introuvable ou inactif.');
      itemId = it.rows[0].id;
      designation = it.rows[0].name;
    } else if ((l.createItem || orderId) && designation) {
      itemId = await ensureStockItem(c, { name: designation, categoryId: l.categoryId, adminId });
    }

    // Valeur du manquant : celle saisie, sinon celle convenue avec le
    // fournisseur pour ce lot, sinon le prix de la ligne elle-même.
    const missingUnitPrice = l.missing_unit_price ?? sourceUnitPrice ?? l.unit_price;

    await c.query(
      `INSERT INTO bon_lines (bon_id, item_id, source_line_id, designation, measure, quantity, unit, weight_kg, cbm, unit_price, missing_unit_price, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [bon.id, itemId, sourceLineId, designation, l.measure, l.quantity, l.unit, l.weight_kg, l.cbm, l.unit_price, missingUnitPrice, l.note]
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
      personType: 'personne', personId: fournisseurId, currency,
      amount: new Decimal(fee).negated().toFixed(2), type: 'transport_fee',
      refOrderId: orderId, refBonId: bon.id, adminId, note: `Frais transport ${bon.reference}`,
    });
  }
  if (new Decimal(discount).gt(0)) {
    await appendEntry(c, {
      personType: 'personne', personId: fournisseurId, currency,
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
  // La commission n'existe que sur un bon FOURNISSEUR : c'est la marge, saisie
  // à la main une fois tous les détails connus. transport_fee reste CE QUE DOIT
  // LE FOURNISSEUR, commission comprise — ce qui évite d'apprendre quoi que ce
  // soit au grand livre, aux totaux d'ordre, au tableau de bord et aux rapports.
  const commission = orderId ? parseMoney(data.commission, 'Commission') : '0';
  const transportFee = linesTotal(lines).plus(commission).toFixed(2);
  const discount = parseMoney(data.discount, 'Remise');

  // Only a bon FOURNISSEUR names a fournisseur: it is that person's shipment.
  // A bon passager's fournisseurs are whoever supplied the lots it carries.
  if (orderId) {
    const f = await c.query('SELECT 1 FROM people WHERE id=$1 AND active=TRUE AND is_fournisseur', [fournisseurId]);
    if (!f.rows.length) throw errors.notFound('Fournisseur introuvable ou inactif.');
  }
  if (data.passagerId) {
    const p = await c.query('SELECT 1 FROM people WHERE id=$1 AND active=TRUE AND is_passager', [data.passagerId]);
    if (!p.rows.length) throw errors.notFound('Passager introuvable ou inactif.');
  }
  const cur = await c.query('SELECT 1 FROM currencies WHERE code=$1 AND active=TRUE', [transportCurrency]);
  if (!cur.rows.length) throw errors.notFound('Devise de transport inconnue.');

  const bonRes = await c.query(
    `INSERT INTO bons (order_id, fournisseur_id, passager_id, transport_currency, transport_fee, commission, discount, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [orderId, orderId ? fournisseurId : null, data.passagerId ?? null, transportCurrency, transportFee, commission, discount, data.notes ?? null, admin.id]
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
        const p = await c.query('SELECT 1 FROM people WHERE id=$1 AND active=TRUE AND is_passager', [newPassagerId]);
        if (!p.rows.length) throw errors.notFound('Passager introuvable ou inactif.');
      }
    }
    const lines = parseLines(data);
    // Fee is derived from the (possibly changed) lines.
    const newCommission = bon.order_id != null
      ? ('commission' in data ? parseMoney(data.commission, 'Commission') : bon.commission)
      : '0';
    const newFee = linesTotal(lines).plus(newCommission).toFixed(2);
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
          personType: 'personne', personId: bon.fournisseur_id, currency: bon.transport_currency,
          amount: new Decimal(bon.transport_fee).toFixed(2), type: 'adjustment',
          refOrderId: bon.order_id, refBonId: id, adminId: admin.id, note: `Annulation frais ${bon.reference} (modification)`,
        });
      }
      if (new Decimal(bon.discount).gt(0)) {
        await appendEntry(c, {
          personType: 'personne', personId: bon.fournisseur_id, currency: bon.transport_currency,
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
      'UPDATE bons SET transport_currency=$2, transport_fee=$3, discount=$4, passager_id=$5, notes=$6, commission=$7 WHERE id=$1',
      [id, newCur, newFee, newDiscount, newPassagerId, data.notes ?? bon.notes, newCommission]
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

    // Reprendre un encaissement rouvre la dette — donc rouvre l'ordre.
    await recomputeOrderStatus(c, entry.ref_order_id ?? bon.order_id);
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
// Suppression dans la transaction du caller. Le rembobinage vers « Créé » — qui
// annule les mouvements de stock, le dû du passager et les avoirs fournisseur —
// et le retrait des lignes forment UN SEUL geste : les séparer laissait, si la
// seconde moitié échouait, un bon rembobiné et vidé de son argent mais toujours
// présent, sans que rien ne dise pourquoi.
export async function deleteBonTx(c, { admin, id, ip }) {
  const bon = (await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!bon) throw errors.notFound('Bon introuvable.');

  if (bon.status !== 'cree') await setBonStatusTx(c, { admin, id, target: 'cree', note: 'Avant suppression', ip });

  {
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
          personType: 'personne', personId: fresh.fournisseur_id, currency: fresh.transport_currency,
          amount: new Decimal(fresh.transport_fee).toFixed(2), type: 'adjustment',
          refBonId: id, adminId: admin.id, note: `Annulation frais ${fresh.reference} (suppression)`,
        });
      }
      if (new Decimal(fresh.discount).gt(0)) {
        await appendEntry(c, {
          personType: 'personne', personId: fresh.fournisseur_id, currency: fresh.transport_currency,
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
  }
}

export async function deleteBon(args) {
  return withTx((c) => deleteBonTx(c, args));
}

// ── Queries ───────────────────────────────────────────────────────────
// Bons PASSAGERS by default.
//
// Creating a bon fournisseur also writes a `bons` row — that row is the crate
// the goods sit in until a passager takes them, and `listAllocatable` below
// reads exactly those. It is not a document anybody files under "bons
// passagers", and the whole codebase already says so: `order_id IS NULL` means
// passager bon in getBonDetail, shipLinesStock, deleteBon and the client. This
// query was the one place that forgot, which is why fournisseur shipments were
// turning up in the passagers table. Pass an explicit `orderId` to look inside
// an order instead.
export async function listBons({ status, search, fournisseurId, passagerId, orderId, limit = 100 } = {}) {
  const params = [];
  const conds = [];
  if (orderId) { params.push(orderId); conds.push(`b.order_id = $${params.length}`); }
  else conds.push('b.order_id IS NULL');
  if (status) { params.push(status); conds.push(`b.status = $${params.length}`); }
  if (passagerId) { params.push(passagerId); conds.push(`b.passager_id = $${params.length}`); }
  // A bon passager has no fournisseur of its own any more — it carries lots from
  // as many as it likes — so filtering by one means "the bons carrying this
  // person's goods", found through the source lines.
  if (fournisseurId) {
    params.push(fournisseurId);
    conds.push(`(b.fournisseur_id = $${params.length} OR EXISTS (
      SELECT 1 FROM bon_lines l JOIN bon_lines src ON src.id = l.source_line_id
        JOIN bons sb ON sb.id = src.bon_id
       WHERE l.bon_id = b.id AND sb.fournisseur_id = $${params.length}))`);
  }
  if (search) { params.push(`%${search}%`); conds.push(`(b.reference ILIKE $${params.length} OR p.name ILIKE $${params.length})`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await getPool().query(
    `SELECT b.*, p.name AS passager_name, o.reference AS order_reference,
            COALESCE(bf.name, (
              SELECT string_agg(DISTINCT sf.name, ', ' ORDER BY sf.name)
                FROM bon_lines l JOIN bon_lines src ON src.id = l.source_line_id
                JOIN bons sb ON sb.id = src.bon_id
                JOIN people sf ON sf.id = sb.fournisseur_id
               WHERE l.bon_id = b.id)) AS fournisseur_name
       FROM bons b
       LEFT JOIN people bf ON bf.id = b.fournisseur_id
       LEFT JOIN people p ON p.id = b.passager_id
       LEFT JOIN orders o ON o.id = b.order_id
       ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getBonDetail(id, client = getPool()) {
  const { rows } = await client.query(
    `SELECT b.*, f.name AS fournisseur_name, f.phone AS fournisseur_phone,
            p.name AS passager_name, p.phone AS passager_phone, p.passager_type,
            a.full_name AS created_by_name, a.role AS created_by_role, o.reference AS order_reference
       FROM bons b
       LEFT JOIN people f ON f.id = b.fournisseur_id
       LEFT JOIN people p ON p.id = b.passager_id
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
            a.full_name AS admin_name, a.role AS admin_role, t.caisse_id, c.label AS caisse_label,
            pe.name AS person_name
       FROM person_ledger pl
       JOIN admins a ON a.id = pl.admin_id
       LEFT JOIN transactions t ON t.id = pl.caisse_tx_id
       LEFT JOIN caisses c ON c.id = t.caisse_id
       LEFT JOIN people pe ON pl.person_type='personne' AND pe.id = pl.person_id
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
    client.query('SELECT h.*, a.full_name AS admin_name, a.role AS admin_role FROM bon_status_history h JOIN admins a ON a.id=h.admin_id WHERE h.bon_id=$1 ORDER BY h.created_at, h.id', [id]),
  ]);
  // Who the goods came from. A bon fournisseur has one, named on the row above;
  // a bon passager has as many as the lots it carries, so they are read off the
  // lines rather than stored — nothing can then drift from what it holds.
  const fournisseurs = await client.query(
    `SELECT DISTINCT f.id, f.name, sb.reference AS source_bon_reference, so.reference AS order_reference
       FROM bon_lines l
       JOIN bon_lines src ON src.id = l.source_line_id
       JOIN bons sb ON sb.id = src.bon_id
       JOIN people f ON f.id = sb.fournisseur_id
       LEFT JOIN orders so ON so.id = sb.order_id
      WHERE l.bon_id = $1 ORDER BY f.name`,
    [id]
  );
  return {
    ...rows[0],
    fournisseurs: fournisseurs.rows,
    lines: lines.rows,
    history: history.rows,
    payments: payments.rows,
  };
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
      // À SA valeur — celle convenue avec le fournisseur pour cette marchandise —
      // et non au tarif de portage : perdre un carton coûte le carton, pas les
      // frais de route.
      const lossValue = new Decimal(dl.missing_unit_price).times(missing);
      lossTotal = lossTotal.plus(lossValue);
      await c.query(
        'UPDATE bon_lines SET received_quantity=$2, loss_value=$3, responsible=$4 WHERE id=$1 AND bon_id=$5',
        [dl.id, delivered.toFixed(3), lossValue.toFixed(2), l.responsible ?? null, id]
      );

      // Un manquant n'est pas seulement une somme d'argent : cette marchandise
      // n'est PAS au bureau. L'arrivée a pourtant crédité Alger de la quantité
      // entière — la réconciliation vient après — donc sans cette correction le
      // stock algérien garde pour toujours des cartons que personne n'a jamais
      // vus, et la ligne ne peut plus jamais être livrée jusqu'à zéro.
      //
      // Un delta, pas une valeur absolue : on peut réconcilier deux fois, et la
      // seconde saisie doit corriger la première au lieu de s'y ajouter.
      const before = dl.received_quantity == null
        ? new Decimal(0)
        : Decimal.max(qty.minus(dl.received_quantity), 0);
      const delta = missing.minus(before);
      if (bon.order_id == null && dl.item_id && !delta.isZero()) {
        const back = delta.negated();
        await applyMovement(c, {
          itemId: dl.item_id, office: 'algeria',
          dQ: dl.measure === 'quantite' ? back.toFixed(3) : '0',
          dW: dl.measure === 'poids' ? back.toFixed(3) : '0',
          dC: dl.measure === 'cbm' ? back.toFixed(4) : '0',
          reason: 'ajustement', refBonId: id, adminId: admin.id,
          note: `Manquant ${bon.reference} — ${dl.designation}`,
        });
      }
    }
    // Le total se relit sur les lignes plutôt que de s'additionner au fil de la
    // boucle : une seconde réconciliation ne nommant qu'une ligne laissait les
    // autres à leur ancienne valeur tout en écrasant l'en-tête, et le bon
    // finissait par ne plus être d'accord avec ses propres lignes.
    const { rows: sum } = await c.query(
      'SELECT COALESCE(SUM(loss_value), 0) AS total FROM bon_lines WHERE bon_id=$1', [id]
    );
    const lossStored = new Decimal(sum[0].total).toFixed(2);
    await c.query('UPDATE bons SET loss_total=$2 WHERE id=$1', [id, lossStored]);
    await writeAudit(c, { adminId: admin.id, action: 'bon.reconcile', entity: 'bon', entityId: id, details: { loss_total: lossStored, lignes_soumises: lossTotal.toFixed(2) }, ip });
    return getBonDetail(id, c);
  });
}

// ── Ce qui a été convenu la dernière fois ─────────────────────────────
// Aucune table de prix : chaque prix jamais convenu est déjà dans bon_lines et
// chaque commission dans bons. Une seconde copie ne pourrait que diverger de
// celle-là. On dérive donc, à la demande, le dernier prix par article — avec
// CETTE personne d'abord (`own`), et à défaut le dernier vu ailleurs (`any`),
// pour que l'écran puisse dire laquelle des deux il propose.
const LAST_PRICES = `
  SELECT DISTINCT ON (COALESCE(bl.item_id::text, bl.designation))
         COALESCE(bl.item_id::text, bl.designation) AS key,
         bl.item_id, bl.designation, bl.unit_price, bl.missing_unit_price,
         b.transport_currency AS currency,
         COALESCE(o.reference, b.reference) AS reference, b.created_at
    FROM bon_lines bl
    JOIN bons b ON b.id = bl.bon_id
    LEFT JOIN orders o ON o.id = b.order_id
   WHERE %WHERE%
   ORDER BY COALESCE(bl.item_id::text, bl.designation), b.created_at DESC, bl.id DESC`;

export async function priceHistory({ fournisseurId, passagerId, scope } = {}) {
  const pool = getPool();
  // Un bon fournisseur porte les prix de revient ; un bon passager les prix de
  // transport. Ce ne sont pas les mêmes nombres, donc pas la même population —
  // et l'écran doit pouvoir dire laquelle il veut avant même qu'une personne
  // soit choisie, sinon un formulaire vide propose les prix de l'autre côté.
  const isFournisseur = scope ? scope === 'fournisseur' : Boolean(fournisseurId);
  const personId = fournisseurId || passagerId;
  const side = isFournisseur ? 'b.order_id IS NOT NULL' : 'b.order_id IS NULL';
  const ownCol = isFournisseur ? 'b.fournisseur_id' : 'b.passager_id';

  const [own, any, lastCommission] = await Promise.all([
    personId
      ? pool.query(LAST_PRICES.replace('%WHERE%', `${side} AND ${ownCol} = $1`), [personId])
      : Promise.resolve({ rows: [] }),
    pool.query(LAST_PRICES.replace('%WHERE%', side)),
    isFournisseur && personId
      ? pool.query(
          `SELECT b.commission, b.transport_currency AS currency,
                  COALESCE(o.reference, b.reference) AS reference, b.created_at
             FROM bons b LEFT JOIN orders o ON o.id = b.order_id
            WHERE b.fournisseur_id = $1 AND b.order_id IS NOT NULL AND b.commission > 0
            ORDER BY b.created_at DESC, b.id DESC LIMIT 1`, [personId])
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    own: own.rows,
    any: any.rows,
    commission: lastCommission.rows[0] ?? null,
  };
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
async function bookSettlement(c, bon, admin, payment, note, owed = '0') {
  await c.query('UPDATE bons SET status=$2, settled_at=now(), passager_payment=$3 WHERE id=$1', [bon.id, 'regle', payment]);
  await c.query('INSERT INTO bon_status_history (bon_id, status, admin_id, note) VALUES ($1,$2,$3,$4)', [bon.id, 'regle', admin.id, note ?? 'Réglé']);
  if (bon.passager_id && new Decimal(payment).gt(0)) {
    await appendEntry(c, {
      personType: 'personne', personId: bon.passager_id, currency: bon.transport_currency,
      amount: payment, type: 'passager_due', refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Dû transport ${bon.reference}`,
    });
  }
  // Ce qu'il n'a pas livré valait plus que son portage : la différence reste à
  // sa charge. Négatif = il vous doit. Son type à elle, pour que le relevé la
  // nomme et que le retour arrière la retrouve sans la recalculer.
  if (bon.passager_id && new Decimal(owed).gt(0)) {
    await appendEntry(c, {
      personType: 'personne', personId: bon.passager_id, currency: bon.transport_currency,
      amount: new Decimal(owed).negated().toFixed(2), type: 'passager_manquant',
      refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Manquants à rembourser ${bon.reference}`,
    });
  }
  for (const cr of await missingSaleCredits(c, bon.id)) {
    await appendEntry(c, {
      personType: 'personne', personId: cr.fournisseur_id, currency: cr.currency,
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
      personType: 'personne', personId: bon.passager_id, currency: bon.transport_currency,
      amount: new Decimal(bon.passager_payment).negated().toFixed(2), type: 'adjustment', refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Annulation dû ${bon.reference}`,
    });
  }
  // La dette de manquant se relit au grand livre plutôt que de se recalculer :
  // un montant payé à la main a pu la remplacer, et un bon réglé puis annulé
  // plusieurs fois ne doit pas la compter deux fois. L'annulation porte le même
  // type, donc la somme des lignes est toujours ce qui reste ouvert.
  const owedRows = await c.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM person_ledger
      WHERE ref_bon_id = $1 AND type = 'passager_manquant'`, [bon.id]
  );
  const owed = new Decimal(owedRows.rows[0].total);
  if (bon.passager_id && !owed.isZero()) {
    await appendEntry(c, {
      personType: 'personne', personId: bon.passager_id, currency: bon.transport_currency,
      amount: owed.negated().toFixed(2), type: 'passager_manquant',
      refOrderId: bon.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Annulation manquants ${bon.reference}`,
    });
  }
  for (const cr of await missingSaleCredits(c, bon.id)) {
    await appendEntry(c, {
      personType: 'personne', personId: cr.fournisseur_id, currency: cr.currency,
      amount: new Decimal(cr.credit).negated().toFixed(2), type: 'adjustment', refOrderId: cr.order_id, refBonId: bon.id,
      adminId: admin.id, note: `Annulation avoir manquants ${bon.reference}`,
    });
  }
  await c.query('UPDATE bons SET passager_payment=NULL, settled_at=NULL WHERE id=$1', [bon.id]);
}

// Défaire la correction de stock des manquants (voir reconcile). Rend à Alger
// ce que la réconciliation en avait retiré, pour que le retrait de la quantité
// entière qui suit retombe exactement sur le niveau d'avant l'arrivée.
async function restoreMissingStock(c, bon, adminId) {
  const { rows } = await c.query(
    `SELECT item_id, designation, measure, received_quantity,
            ${'CASE WHEN measure=\'poids\' THEN weight_kg WHEN measure=\'cbm\' THEN cbm ELSE quantity END'} AS qty
       FROM bon_lines
      WHERE bon_id=$1 AND item_id IS NOT NULL AND received_quantity IS NOT NULL`,
    [bon.id]
  );
  for (const l of rows) {
    const missing = Decimal.max(new Decimal(l.qty).minus(l.received_quantity), 0);
    if (missing.isZero()) continue;
    await applyMovement(c, {
      itemId: l.item_id, office: 'algeria',
      dQ: l.measure === 'quantite' ? missing.toFixed(3) : '0',
      dW: l.measure === 'poids' ? missing.toFixed(3) : '0',
      dC: l.measure === 'cbm' ? missing.toFixed(4) : '0',
      reason: 'ajustement', refBonId: bon.id, adminId,
      note: `Annulation manquant ${bon.reference} — ${l.designation}`,
    });
  }
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

    // Ce que vaut le portage, moins ce qui n'est pas arrivé.
    const net = new Decimal(bon.transport_fee).minus(bon.loss_total);
    const manual = passagerPayment != null && passagerPayment !== '';
    const payment = manual ? parseMoney(passagerPayment, 'Paiement passager') : Decimal.max(net, 0).toFixed(2);
    // Un montant saisi à la main vaut décision et remplace ce calcul ; sinon,
    // ne rien payer n'efface pas la différence, elle reste due par le passager.
    const owed = !manual && net.lt(0) ? net.negated().toFixed(2) : '0';

    await bookSettlement(c, bon, admin, payment, note, owed);
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

// The stepper's work, running in the CALLER's transaction. An order moving all
// of its bons at once has to be one transaction: half a shipment advanced and
// half not is a state nothing in this codebase knows how to read.
export async function setBonStatusTx(c, { admin, id, target, note, ip }) {
  if (!STAGES.includes(target)) throw errors.validation([{ field: 'target', message: 'Statut invalide.' }]);
  {
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
          const net = new Decimal(bon.transport_fee).minus(bon.loss_total);
          const payment = Decimal.max(net, 0).toFixed(2);
          const owed = net.lt(0) ? net.negated().toFixed(2) : '0';
          await bookSettlement(c, bon, admin, payment, note ?? 'Changement de statut', owed);
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
          // L'ordre compte : la réconciliation avait RETIRÉ les manquants
          // d'Alger, et reverseShip va retirer la quantité ENTIÈRE. Sans
          // remettre d'abord les manquants, ils seraient déduits deux fois et le
          // stock algérien finirait négatif.
          if (isPassagerBon) await restoreMissingStock(c, bon, admin.id);
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
  }
}

export async function setBonStatus(args) {
  return withTx((c) => setBonStatusTx(c, args));
}

// ── Auto-post money events ─────────────────────────────────────────────
// Fournisseur pays transport fee → cash INTO an office caisse + reduce their debt.
// Ce qui est DÉJÀ passé en caisse sur ce bon, par type d'écriture. Le plafond
// des deux fonctions ci-dessous s'en déduit — sans lui, appeler l'endpoint deux
// fois encaisse ou paie deux fois : un double-clic, ou simplement un réessai
// après un timeout réseau alors que le premier appel avait abouti.
async function alreadyMoved(c, bonId, type) {
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM person_ledger
      WHERE ref_bon_id = $1 AND type = $2`,
    [bonId, type]
  );
  return new Decimal(rows[0].total);
}

export async function collectFee({ admin, id, caisseId, amount, note, ip }) {
  return withTx(async (c) => {
    // FOR UPDATE : deux encaissements simultanés sur le même bon lisaient tous
    // les deux « rien encaissé » et postaient tous les deux le total.
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    // Only a bon fournisseur ever billed anyone: the sale was charged once, at
    // reception. A bon passager moves the same goods and owes nothing — cashing
    // against it would credit a debt that does not exist.
    if (bon.order_id == null) {
      throw errors.conflict('Un bon passager n’encaisse pas de frais : la vente a été facturée au fournisseur à la réception.');
    }
    const paid = await alreadyMoved(c, id, 'fee_payment');
    const due = new Decimal(bon.transport_fee).minus(paid);
    if (due.lte(0)) {
      throw errors.conflict(`Frais déjà encaissés en totalité pour ${bon.reference} (${paid.toFixed(2)} ${bon.transport_currency}).`);
    }
    const amt = amount != null && amount !== '' ? parseMoney(amount, 'Montant', { allowZero: false }) : due.toFixed(2);
    if (!(new Decimal(amt).gt(0))) throw errors.invalidAmount('Aucun montant à encaisser.');
    if (new Decimal(amt).gt(due)) {
      throw errors.conflict(`Montant supérieur au reste dû : il reste ${due.toFixed(2)} ${bon.transport_currency} sur ${bon.reference}.`);
    }

    const { txId } = await postMovement(c, {
      caisseId, currency: bon.transport_currency, direction: 'in', amount: amt,
      type: 'order_fee', note: note ?? `Encaissement frais ${bon.reference}`, adminId: admin.id,
    });
    await appendEntry(c, {
      personType: 'personne', personId: bon.fournisseur_id, currency: bon.transport_currency,
      amount: amt, type: 'fee_payment', refOrderId: bon.order_id, refBonId: bon.id,
      caisseTxId: txId, adminId: admin.id, note,
    });
    // Le paiement est devenu une porte du statut : un ordre entièrement livré
    // ne se clôture qu'une fois les frais encaissés. Sans ce recalcul, le
    // dernier dinar reçu ne referme rien, et l'ordre reste « livrée » jusqu'à
    // ce qu'autre chose vienne le toucher par hasard.
    await recomputeOrderStatus(c, bon.order_id);
    await writeAudit(c, { adminId: admin.id, action: 'bon.collect_fee', entity: 'bon', entityId: id, details: { amount: amt, caisseId }, ip });
    return getBonDetail(id, c);
  });
}

// Pay the passager → cash OUT of an office caisse + reduce what we owe them.
export async function payPassager({ admin, id, caisseId, amount, note, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM bons WHERE id=$1 FOR UPDATE', [id]);
    const bon = rows[0];
    if (!bon) throw errors.notFound('Bon introuvable.');
    if (bon.status !== 'regle') throw errors.conflict('Le bon doit être réglé avant de payer le passager.');
    if (!bon.passager_id) throw errors.conflict('Aucun passager sur ce bon.');
    const paid = await alreadyMoved(c, id, 'passager_payment');
    const due = new Decimal(bon.passager_payment ?? 0).minus(paid);
    if (due.lte(0)) {
      throw errors.conflict(`Passager déjà payé en totalité pour ${bon.reference} (${paid.toFixed(2)} ${bon.transport_currency}).`);
    }
    const amt = amount != null && amount !== '' ? parseMoney(amount, 'Montant', { allowZero: false }) : due.toFixed(2);
    if (amt == null || !(new Decimal(amt).gt(0))) throw errors.invalidAmount('Aucun paiement à effectuer.');
    if (new Decimal(amt).gt(due)) {
      throw errors.conflict(`Montant supérieur au reste à payer : il reste ${due.toFixed(2)} ${bon.transport_currency} sur ${bon.reference}.`);
    }

    const { txId } = await postMovement(c, {
      caisseId, currency: bon.transport_currency, direction: 'out', amount: amt,
      type: 'passager_payment', note: note ?? `Paiement passager ${bon.reference}`, adminId: admin.id,
    });
    await appendEntry(c, {
      personType: 'personne', personId: bon.passager_id, currency: bon.transport_currency,
      amount: new Decimal(amt).negated().toFixed(2), type: 'passager_payment',
      refOrderId: bon.order_id, refBonId: bon.id, caisseTxId: txId, adminId: admin.id, note,
    });
    await writeAudit(c, { adminId: admin.id, action: 'bon.pay_passager', entity: 'bon', entityId: id, details: { amount: amt, caisseId }, ip });
    return getBonDetail(id, c);
  });
}
