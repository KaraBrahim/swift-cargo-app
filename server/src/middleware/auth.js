// Session auth. Reads a Bearer token (or `sc_token` cookie), validates it
// against the sessions table, and attaches req.admin. All 4 admins share one
// permission level, so there is only "authenticated" — no role checks needed.
import { getPool } from '../db/pool.js';
import { errors } from '../lib/AppError.js';

function extractToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies && req.cookies.sc_token) return req.cookies.sc_token;
  return null;
}

export async function requireAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw errors.unauthorized();

    const { rows } = await getPool().query(
      `SELECT a.id, a.username, a.full_name, a.office, a.role, s.expires_at
         FROM sessions s
         JOIN admins a ON a.id = s.admin_id
        WHERE s.token = $1 AND a.active = TRUE`,
      [token]
    );
    const session = rows[0];
    if (!session) throw errors.unauthorized('Session invalide.');
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await getPool().query('DELETE FROM sessions WHERE token = $1', [token]);
      throw errors.unauthorized('Session expirée.');
    }

    req.admin = { id: session.id, username: session.username, full_name: session.full_name, office: session.office, role: session.role };
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

// Gate for actions only the super-admin may perform (admin-account CRUD).
export function requireSuperadmin(req, _res, next) {
  if (req.admin?.role !== 'superadmin') {
    return next(errors.forbidden('Réservé au super-administrateur.'));
  }
  next();
}
