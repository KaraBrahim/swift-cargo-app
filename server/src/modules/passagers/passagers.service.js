import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

export async function listPassagers({ search, type, includeInactive } = {}) {
  const params = [];
  const conds = [];
  if (!includeInactive) conds.push('active = TRUE');
  if (type) {
    params.push(type);
    conds.push(`type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(full_name ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await getPool().query(`SELECT * FROM passagers ${where} ORDER BY full_name`, params);
  return rows;
}

export async function getPassager(id) {
  const { rows } = await getPool().query('SELECT * FROM passagers WHERE id = $1', [id]);
  if (!rows[0]) throw errors.notFound('Passager introuvable.');
  return rows[0];
}

export async function createPassager({ admin, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO passagers (type, full_name, phone, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [data.type, data.full_name, data.phone ?? null, data.notes ?? null]
    );
    await writeAudit(c, { adminId: admin.id, action: 'passager.create', entity: 'passager', entityId: rows[0].id, details: { full_name: data.full_name, type: data.type }, ip });
    return rows[0];
  });
}

export async function updatePassager({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `UPDATE passagers SET type=$2, full_name=$3, phone=$4, notes=$5 WHERE id=$1 RETURNING *`,
      [id, data.type, data.full_name, data.phone ?? null, data.notes ?? null]
    );
    if (!rows[0]) throw errors.notFound('Passager introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'passager.update', entity: 'passager', entityId: id, ip });
    return rows[0];
  });
}

export async function setPassagerActive({ admin, id, active, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query('UPDATE passagers SET active=$2 WHERE id=$1 RETURNING *', [id, active]);
    if (!rows[0]) throw errors.notFound('Passager introuvable.');
    await writeAudit(c, { adminId: admin.id, action: 'passager.set_active', entity: 'passager', entityId: id, details: { active }, ip });
    return rows[0];
  });
}
