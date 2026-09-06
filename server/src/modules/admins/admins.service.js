// Admin (utilisateur) management.
//
// These operations are restricted to the SUPER-ADMIN (see requireSuperadmin on
// the routes): only they may create, edit, deactivate, or reset the password of
// an admin account. The four office admins keep identical permissions to one
// another but can no longer manage accounts. Guards below prevent self-lockout
// and protect the super-admin account itself.
import bcrypt from 'bcryptjs';
import { config } from '../../config.js';
import { getPool, withTx } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

const PUBLIC_COLS = `id, username, full_name, office, role, email, phone, active, created_at, last_login_at`;

// The super-admin is invisible to everyone else — and this list is the one
// place the rule could be walked around, because it returns `full_name`, which
// the response scrubber does not touch (it masks the *_name actor columns).
// Any signed-in admin may call this endpoint, so the filter belongs here.
export async function listAdmins({ includeInactive = false, viewerIsSuperadmin = false } = {}) {
  const clauses = [];
  if (!includeInactive) clauses.push('active = TRUE');
  if (!viewerIsSuperadmin) clauses.push("role <> 'superadmin'");
  const { rows } = await getPool().query(
    `SELECT ${PUBLIC_COLS} FROM admins
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY active DESC, office NULLS LAST, full_name`
  );
  return rows;
}

async function countActive(client, exceptId = null) {
  const { rows } = await client.query(
    'SELECT COUNT(*)::int AS n FROM admins WHERE active = TRUE AND ($1::int IS NULL OR id <> $1)',
    [exceptId]
  );
  return rows[0].n;
}

export async function createAdmin({ admin, data, ip }) {
  return withTx(async (c) => {
    const exists = await c.query('SELECT 1 FROM admins WHERE lower(username) = lower($1)', [data.username]);
    if (exists.rows.length) throw errors.conflict('Cet identifiant est déjà utilisé.');

    const hash = await bcrypt.hash(data.password, config.bcryptRounds);
    const { rows } = await c.query(
      `INSERT INTO admins (username, full_name, password_hash, office, email, phone)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${PUBLIC_COLS}`,
      [data.username, data.full_name, hash, data.office ?? null, data.email ?? null, data.phone ?? null]
    );
    await writeAudit(c, {
      adminId: admin.id, action: 'admin.create', entity: 'admin', entityId: rows[0].id,
      details: { username: data.username, office: data.office ?? null }, ip,
    });
    return rows[0];
  });
}

export async function updateAdmin({ admin, id, data, ip }) {
  return withTx(async (c) => {
    const { rows } = await c.query(
      `UPDATE admins SET full_name = $2, office = $3, email = $4, phone = $5
        WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
      [id, data.full_name, data.office ?? null, data.email ?? null, data.phone ?? null]
    );
    if (!rows[0]) throw errors.notFound('Utilisateur introuvable.');
    await writeAudit(c, {
      adminId: admin.id, action: 'admin.update', entity: 'admin', entityId: id,
      details: { full_name: data.full_name, office: data.office ?? null }, ip,
    });
    return rows[0];
  });
}

export async function setAdminActive({ admin, id, active, ip }) {
  if (!active && Number(id) === Number(admin.id)) {
    throw errors.conflict('Vous ne pouvez pas désactiver votre propre compte.');
  }
  return withTx(async (c) => {
    if (!active) {
      const tgt = await c.query('SELECT role FROM admins WHERE id = $1', [id]);
      if (tgt.rows[0]?.role === 'superadmin') {
        throw errors.conflict('Le compte super-administrateur ne peut pas être désactivé.');
      }
      if ((await countActive(c, id)) === 0) {
        throw errors.conflict('Impossible de désactiver le dernier utilisateur actif.');
      }
    }
    const { rows } = await c.query(
      `UPDATE admins SET active = $2 WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
      [id, active]
    );
    if (!rows[0]) throw errors.notFound('Utilisateur introuvable.');
    // A deactivated admin must not keep a live session.
    if (!active) await c.query('DELETE FROM sessions WHERE admin_id = $1', [id]);
    await writeAudit(c, {
      adminId: admin.id, action: 'admin.set_active', entity: 'admin', entityId: id,
      details: { active }, ip,
    });
    return rows[0];
  });
}

export async function resetPassword({ admin, id, newPassword, ip }) {
  return withTx(async (c) => {
    const found = await c.query('SELECT id FROM admins WHERE id = $1', [id]);
    if (!found.rows.length) throw errors.notFound('Utilisateur introuvable.');

    const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await c.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [id, hash]);
    // Force a re-login everywhere with the old password.
    await c.query('DELETE FROM sessions WHERE admin_id = $1', [id]);
    await writeAudit(c, {
      adminId: admin.id, action: 'admin.reset_password', entity: 'admin', entityId: id,
      details: { by: admin.username ?? admin.id }, ip,
    });
    return { ok: true };
  });
}
