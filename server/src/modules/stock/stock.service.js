import { getPool, withTx } from '../../db/pool.js';
import { Decimal, toDecimal } from '../../lib/money.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

// Non-negative quantity/measure parser at a given scale (qty=3, cbm=4).
function parseQty(v, scale, field) {
  const d = toDecimal(v ?? '0', field);
  if (d.lt(0)) throw errors.invalidAmount(`${field} : ne peut pas être négatif.`);
  if (d.decimalPlaces() > scale) throw errors.invalidAmount(`${field} : maximum ${scale} décimales.`);
  if (d.gt(new Decimal('1e12'))) throw errors.invalidAmount(`${field} : valeur trop élevée.`);
  return d.toFixed(scale);
}

// ── Categories (dynamic, admin-created) ──────────────────────────────
export async function listCategories({ includeInactive } = {}) {
  const where = includeInactive ? '' : 'WHERE c.active = TRUE';
  // item_count lets the UI say why a category cannot be deleted.
  const { rows } = await getPool().query(
    `SELECT c.*, (SELECT COUNT(*) FROM stock_items i WHERE i.category_id = c.id) AS item_count
       FROM stock_categories c ${where} ORDER BY c.name`
  );
  return rows;
}

// A category is removable only while no article points at it — deactivate it
// instead of orphaning a catalogue.
export async function deleteCategory({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM stock_categories WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw errors.notFound('Catégorie introuvable.');
    const used = await c.query('SELECT COUNT(*)::int AS n FROM stock_items WHERE category_id=$1', [id]);
    if (used.rows[0].n > 0) {
      throw errors.conflict(`Suppression impossible : ${used.rows[0].n} article(s) utilisent cette catégorie. Désactivez-la ou réaffectez ces articles.`);
    }
    await c.query('DELETE FROM stock_categories WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'stock.category.delete', entity: 'stock_category', entityId: id, details: { name: rows[0].name }, ip });
    return { deleted: true };
  });
}

export async function createCategory({ admin, name, ip }) {
  return withTx(async (c) => {
    const exists = await c.query('SELECT 1 FROM stock_categories WHERE lower(name) = lower($1)', [name]);
    if (exists.rows.length) throw errors.conflict('Cette catégorie existe déjà.');
    const { rows } = await c.query('INSERT INTO stock_categories (name) VALUES ($1) RETURNING *', [name]);
    await writeAudit(c, { adminId: admin.id, action: 'stock.category.create', entity: 'stock_category', entityId: rows[0].id, details: { name }, ip });
    return rows[0];
  });
}

export async function updateCategory({ admin, id, name, active, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('UPDATE stock_categories SET name=$2, active=$3 WHERE id=$1 RETURNING *', [id, name, active]);
    if (!rows[0]) throw errors.notFound('Catégorie introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'stock.category.update', entity: 'stock_category', entityId: id, ip });
    return rows[0];
  });
}

// Insert-or-reuse a catalogue article inside the CALLER's transaction (used when
// a bon line creates a new article on the fly). Dedupes by lower(name) so the
// same designation typed twice does not spawn duplicates. Category is optional.
export async function ensureStockItem(c, { name, categoryId = null, adminId }) {
  const clean = String(name || '').trim();
  if (!clean) throw errors.validation([{ field: 'name', message: 'Nom de l’article requis.' }]);

  const found = await c.query(
    'SELECT id FROM stock_items WHERE lower(name) = lower($1) AND active = TRUE LIMIT 1',
    [clean]
  );
  if (found.rows[0]) return found.rows[0].id;

  if (categoryId) {
    const cat = await c.query('SELECT 1 FROM stock_categories WHERE id=$1 AND active=TRUE', [categoryId]);
    if (!cat.rows.length) throw errors.notFound('Catégorie introuvable ou inactive.');
  }
  const ins = await c.query(
    `INSERT INTO stock_items (category_id, name) VALUES ($1,$2) RETURNING id`,
    [categoryId || null, clean]
  );
  await writeAudit(c, {
    adminId, action: 'stock.item.create', entity: 'stock_item', entityId: ins.rows[0].id,
    details: { name: clean, via: 'bon' }, ip: null,
  });
  return ins.rows[0].id;
}

// ── Items ────────────────────────────────────────────────────────────
export async function listItems({ search, categoryId, includeInactive } = {}) {
  const params = [];
  const conds = [];
  if (!includeInactive) conds.push('i.active = TRUE');
  if (categoryId) {
    params.push(categoryId);
    conds.push(`i.category_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conds.push(`i.name ILIKE $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  // The catalogue view is about the ARTICLE, not its quantities — but it still
  // reports whether any office holds stock and whether bons reference it, so the
  // UI can separate "just registered" from "really in stock" and explain refusals.
  const { rows } = await getPool().query(
    `SELECT i.*, c.name AS category_name,
            COALESCE((SELECT SUM(l.quantity + l.weight_kg + l.cbm) FROM stock_levels l WHERE l.item_id = i.id), 0) AS stock_total,
            (SELECT COUNT(*) FROM bon_lines b WHERE b.item_id = i.id)::int AS line_count
       FROM stock_items i LEFT JOIN stock_categories c ON c.id = i.category_id
       ${where} ORDER BY i.name`,
    params
  );
  return rows;
}

// An article can be deleted only while nothing depends on it: no bon line ever
// used it and no office holds any of it. Otherwise it must be deactivated, so
// historical bons keep their designation.
export async function deleteItem({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM stock_items WHERE id=$1 FOR UPDATE', [id]);
    const item = rows[0];
    if (!item) throw errors.notFound('Article introuvable.');

    const lines = await c.query('SELECT COUNT(*)::int AS n FROM bon_lines WHERE item_id=$1', [id]);
    if (lines.rows[0].n > 0) {
      throw errors.conflict(`Suppression impossible : « ${item.name} » figure sur ${lines.rows[0].n} ligne(s) de bon. Désactivez-le pour le retirer des listes.`);
    }
    const held = await c.query(
      'SELECT COALESCE(SUM(quantity + weight_kg + cbm),0) AS total FROM stock_levels WHERE item_id=$1', [id]
    );
    if (Number(held.rows[0].total) !== 0) {
      throw errors.conflict(`Suppression impossible : « ${item.name} » est encore en stock. Ramenez sa quantité à zéro d’abord.`);
    }
    await c.query('DELETE FROM stock_levels WHERE item_id=$1', [id]);
    await c.query('DELETE FROM stock_movements WHERE item_id=$1', [id]);
    await c.query('DELETE FROM stock_items WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'stock.item.delete', entity: 'stock_item', entityId: id, details: { name: item.name }, ip });
    return { deleted: true };
  });
}

export async function getItem(id) {
  const { rows } = await getPool().query('SELECT * FROM stock_items WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Article introuvable.');
  return rows[0];
}

export async function createItem({ admin, data, ip }) {
  return withTx(async (c) => {
    if (data.category_id) {
      const cat = await c.query('SELECT 1 FROM stock_categories WHERE id=$1 AND active=TRUE', [data.category_id]);
      if (!cat.rows.length) throw errors.notFound('Catégorie introuvable ou inactive.');
    }
    const exists = await c.query('SELECT 1 FROM stock_items WHERE lower(name)=lower($1) AND active=TRUE', [data.name]);
    if (exists.rows.length) throw errors.conflict('Un article portant ce nom existe déjà.');
    const { rows } = await c.query(
      `INSERT INTO stock_items (category_id, name, notes) VALUES ($1,$2,$3) RETURNING *`,
      [data.category_id ?? null, data.name, data.notes ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'stock.item.create', entity: 'stock_item', entityId: rows[0].id, details: { name: data.name }, ip });
    return rows[0];
  });
}

export async function updateItem({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `UPDATE stock_items SET category_id=$2, name=$3, notes=$4, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, data.category_id ?? null, data.name, data.notes ?? null]
    );
    if (!rows[0]) throw errors.notFound('Article introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'stock.item.update', entity: 'stock_item', entityId: id, ip });
    return rows[0];
  });
}

// ── Per-office levels + movement ledger ──────────────────────────────
// Apply a signed stock movement at an office inside the caller's tx: lock the
// level row, add the deltas, and record the movement for history.
export async function applyMovement(c, { itemId, office, dQ = '0', dW = '0', dC = '0', reason, refOrderId = null, refBonId = null, adminId, note = null }) {
  await c.query('INSERT INTO stock_levels (item_id, office) VALUES ($1,$2) ON CONFLICT (item_id, office) DO NOTHING', [itemId, office]);
  await c.query('SELECT 1 FROM stock_levels WHERE item_id=$1 AND office=$2 FOR UPDATE', [itemId, office]);
  await c.query(
    'UPDATE stock_levels SET quantity=quantity+$3, weight_kg=weight_kg+$4, cbm=cbm+$5 WHERE item_id=$1 AND office=$2',
    [itemId, office, dQ, dW, dC]
  );
  await c.query(
    `INSERT INTO stock_movements (item_id, office, quantity_delta, weight_delta, cbm_delta, reason, ref_order_id, ref_bon_id, admin_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [itemId, office, dQ, dW, dC, reason, refOrderId, refBonId, adminId, note]
  );
}

// Catalogue articles with their level at a given office.
export async function listLevels({ office = 'china', search, categoryId } = {}) {
  const params = [office];
  const conds = ['i.active = TRUE'];
  if (categoryId) { params.push(categoryId); conds.push(`i.category_id = $${params.length}`); }
  if (search) { params.push(`%${search}%`); conds.push(`i.name ILIKE $${params.length}`); }
  const { rows } = await getPool().query(
    `SELECT i.id, i.name, i.category_id, c.name AS category_name,
            COALESCE(l.quantity,0)  AS quantity,
            COALESCE(l.weight_kg,0) AS weight_kg,
            COALESCE(l.cbm,0)       AS cbm
       FROM stock_items i
       LEFT JOIN stock_categories c ON c.id = i.category_id
       LEFT JOIN stock_levels l ON l.item_id = i.id AND l.office = $1
      WHERE ${conds.join(' AND ')}
      ORDER BY i.name`,
    params
  );
  return rows;
}

export async function setItemActive({ admin, id, active, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('UPDATE stock_items SET active=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, active]);
    if (!rows[0]) throw errors.notFound('Article introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'stock.item.set_active', entity: 'stock_item', entityId: id, details: { active }, ip });
    return rows[0];
  });
}

// ── Manual inventory: set an article's absolute level at ONE office ───
export async function setLevel({ admin, itemId, office, quantity, weight_kg, cbm, note, ip }) {
  const tQ = parseQty(quantity ?? '0', 3, 'Quantité');
  const tW = parseQty(weight_kg ?? '0', 3, 'Poids');
  const tC = parseQty(cbm ?? '0', 4, 'CBM');
  return withTx(async (c) => {
    const it = await c.query('SELECT 1 FROM stock_items WHERE id=$1', [itemId]);
    if (!it.rows.length) throw errors.notFound('Article introuvable.');
    await c.query('INSERT INTO stock_levels (item_id, office) VALUES ($1,$2) ON CONFLICT (item_id, office) DO NOTHING', [itemId, office]);
    const cur = (await c.query('SELECT quantity, weight_kg, cbm FROM stock_levels WHERE item_id=$1 AND office=$2 FOR UPDATE', [itemId, office])).rows[0];
    const dQ = new Decimal(tQ).minus(cur.quantity).toFixed(3);
    const dW = new Decimal(tW).minus(cur.weight_kg).toFixed(3);
    const dC = new Decimal(tC).minus(cur.cbm).toFixed(4);
    await applyMovement(c, { itemId, office, dQ, dW, dC, reason: 'inventaire', adminId: admin.id, note: note ?? null });
    await writeAudit(c, {
      adminId: admin.id, action: 'stock.inventory', entity: 'stock_item', entityId: itemId,
      details: { office, quantity: tQ, weight_kg: tW, cbm: tC }, ip,
    });
    return { itemId, office, quantity: tQ, weight_kg: tW, cbm: tC };
  });
}

// Everything worth knowing about one article: where it physically is, how it got
// there, and which bons reference it — so the page can answer "can I delete this?"
// before the user tries.
export async function getItemDetail(id) {
  const { rows } = await getPool().query(
    `SELECT i.*, c.name AS category_name
       FROM stock_items i LEFT JOIN stock_categories c ON c.id = i.category_id
      WHERE i.id = $1`, [id]
  );
  const item = rows[0];
  if (!item) throw errors.notFound('Article introuvable.');

  const [levels, movements, bons] = await Promise.all([
    getPool().query(
      `SELECT office, quantity, weight_kg, cbm FROM stock_levels WHERE item_id=$1 ORDER BY office`, [id]
    ),
    getPool().query(
      `SELECT m.*, a.full_name AS admin_name, b.reference AS bon_reference, o.reference AS order_reference
         FROM stock_movements m
         LEFT JOIN admins a ON a.id = m.admin_id
         LEFT JOIN bons b   ON b.id = m.ref_bon_id
         LEFT JOIN orders o ON o.id = m.ref_order_id
        WHERE m.item_id=$1 ORDER BY m.created_at DESC, m.id DESC LIMIT 60`, [id]
    ),
    getPool().query(
      `SELECT bl.id AS line_id, bl.measure, bl.quantity, bl.weight_kg, bl.cbm, bl.unit, bl.unit_price,
              b.id AS bon_id, b.reference, b.status, b.order_id,
              f.name AS fournisseur_name, p.full_name AS passager_name
         FROM bon_lines bl
         JOIN bons b ON b.id = bl.bon_id
         JOIN fournisseurs f ON f.id = b.fournisseur_id
         LEFT JOIN passagers p ON p.id = b.passager_id
        WHERE bl.item_id=$1 ORDER BY b.created_at DESC, bl.id DESC LIMIT 60`, [id]
    ),
  ]);

  const totals = levels.rows.reduce((a, l) => ({
    quantity: a.quantity + Number(l.quantity),
    weight_kg: a.weight_kg + Number(l.weight_kg),
    cbm: a.cbm + Number(l.cbm),
  }), { quantity: 0, weight_kg: 0, cbm: 0 });

  return {
    ...item,
    levels: levels.rows,
    movements: movements.rows,
    bons: bons.rows,
    totals,
    // Deletion is only possible when nothing references it and nothing is held.
    deletable: bons.rows.length === 0 && totals.quantity === 0 && totals.weight_kg === 0 && totals.cbm === 0,
  };
}

// Remove a manual stock correction. Movements produced by a bon belong to that
// bon's lifecycle and must be undone there, never here.
export async function deleteMovement({ admin, id, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM stock_movements WHERE id=$1 FOR UPDATE', [id]);
    const m = rows[0];
    if (!m) throw errors.notFound('Mouvement introuvable.');
    if (!['inventaire', 'ajustement'].includes(m.reason)) {
      throw errors.conflict('Ce mouvement provient d’un bon : annulez-le depuis le bon concerné.');
    }
    // Apply the exact opposite, then drop both rows.
    await applyMovement(c, {
      itemId: m.item_id, office: m.office,
      dQ: new Decimal(m.quantity_delta).negated().toFixed(3),
      dW: new Decimal(m.weight_delta).negated().toFixed(3),
      dC: new Decimal(m.cbm_delta).negated().toFixed(4),
      reason: 'ajustement', adminId: admin.id, note: 'Annulation d’un mouvement manuel',
    });
    await c.query('DELETE FROM stock_movements WHERE id=$1', [id]);
    await writeAudit(c, { adminId: admin.id, action: 'stock.movement.delete', entity: 'stock_movement', entityId: id, details: { office: m.office, reason: m.reason }, ip });
    return { deleted: true };
  });
}

export async function listInventory({ itemId, limit = 100 } = {}) {
  const params = [limit];
  let where = '';
  if (itemId) {
    params.push(itemId);
    where = `WHERE inv.item_id = $${params.length}`;
  }
  const { rows } = await getPool().query(
    `SELECT inv.*, it.name AS item_name, a.full_name AS admin_name
       FROM stock_inventory inv
       JOIN stock_items it ON it.id = inv.item_id
       JOIN admins a ON a.id = inv.admin_id
       ${where} ORDER BY inv.created_at DESC, inv.id DESC LIMIT $1`,
    params
  );
  return rows;
}
