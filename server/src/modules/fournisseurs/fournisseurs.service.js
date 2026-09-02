import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

export async function listFournisseurs({ search, includeInactive } = {}) {
  const params = [];
  const conds = [];
  if (!includeInactive) conds.push('active = TRUE');
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR city ILIKE $${params.length})`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await getPool().query(`SELECT * FROM fournisseurs ${where} ORDER BY name`, params);
  return rows;
}

export async function getFournisseur(id) {
  const { rows } = await getPool().query('SELECT * FROM fournisseurs WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Fournisseur introuvable.');
  return rows[0];
}

export async function createFournisseur({ admin, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO fournisseurs (name, phone, city, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [data.name, data.phone ?? null, data.city ?? null, data.notes ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'fournisseur.create', entity: 'fournisseur', entityId: rows[0].id, details: { name: data.name }, ip });
    return rows[0];
  });
}

export async function updateFournisseur({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `UPDATE fournisseurs SET name=$2, phone=$3, city=$4, notes=$5 WHERE id=$1 RETURNING *`,
      [id, data.name, data.phone ?? null, data.city ?? null, data.notes ?? null]
    );
    if (!rows[0]) throw errors.notFound('Fournisseur introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'fournisseur.update', entity: 'fournisseur', entityId: id, ip });
    return rows[0];
  });
}

export async function setFournisseurActive({ admin, id, active, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('UPDATE fournisseurs SET active=$2 WHERE id=$1 RETURNING *', [id, active]);
    if (!rows[0]) throw errors.notFound('Fournisseur introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'fournisseur.set_active', entity: 'fournisseur', entityId: id, details: { active }, ip });
    return rows[0];
  });
}
