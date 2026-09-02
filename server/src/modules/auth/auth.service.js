import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getPool, withTx } from '../../db/pool.js';
import { config } from '../../config.js';
import { errors } from '../../lib/AppError.js';
import { writeAudit } from '../../lib/audit.js';

// When the username does not exist there is no hash to check, so the reply comes
// back immediately — and that timing difference alone tells an attacker which
// usernames are real. To avoid it we still run one bcrypt comparison, against a
// stored hash borrowed from a real account.
//
// It has to be a REAL one: a hardcoded hash carries its own cost factor, and if
// that differs from what the accounts actually use, the fake path becomes slower
// (or faster) than the genuine one and leaks even more clearly than saying
// nothing. Borrowing a live hash makes the two paths cost the same by
// construction, whatever the cost factor is now or after a rehash.
//
// The comparison result is discarded, so it reveals nothing about that account.
let decoyHash = null;
async function timingDecoy(password) {
  if (!decoyHash) {
    const { rows } = await getPool().query(
      'SELECT password_hash FROM admins WHERE active = TRUE ORDER BY id LIMIT 1'
    );
    decoyHash = rows[0]?.password_hash || (await bcrypt.hash('decoy', config.bcryptRounds));
  }
  await bcrypt.compare(password, decoyHash);
}

const publicAdmin = (a) => ({ id: a.id, username: a.username, full_name: a.full_name, office: a.office, role: a.role });

// ── Login throttle ──────────────────────────────────────────────────
// Counted from login_attempts so it survives a restart. Two independent
// limits: per IP (what actually stops a guessing run) and per username (a
// second net for an attacker spread across addresses).
//
// A username limit is always a trade-off — someone who knows a username can
// deliberately lock it for the window. That is why the window is short and a
// SUCCESSFUL login clears that account's failures immediately, so a user who
// mistyped a few times is never left waiting.
async function assertNotThrottled({ username, ip }) {
  const { rows } = await getPool().query(
    `SELECT
       count(*) FILTER (WHERE lower(username) = lower($1)) AS by_user,
       count(*) FILTER (WHERE ip IS NOT NULL AND ip = $2)  AS by_ip
     FROM login_attempts
     WHERE success = FALSE AND at > now() - make_interval(mins => $3)`,
    [username, ip ?? null, config.loginWindowMinutes]
  );
  const byUser = Number(rows[0].by_user);
  const byIp = Number(rows[0].by_ip);
  if (byIp >= config.loginMaxPerIp || byUser >= config.loginMaxPerUser) {
    throw errors.tooManyRequests(
      `Trop de tentatives de connexion. Réessayez dans ${config.loginWindowMinutes} minutes.`,
      { retryAfterMinutes: config.loginWindowMinutes }
    );
  }
}

const recordAttempt = (client, { username, ip, success }) =>
  client.query('INSERT INTO login_attempts (username, ip, success) VALUES ($1,$2,$3)', [
    username,
    ip ?? null,
    success,
  ]);

// Housekeeping on each successful login: cheap, indexed, and it keeps two
// append-only tables from growing forever.
async function sweep(client, username) {
  await client.query("DELETE FROM login_attempts WHERE at < now() - interval '7 days'");
  await client.query('DELETE FROM sessions WHERE expires_at < now()');
  await client.query(
    'DELETE FROM login_attempts WHERE success = FALSE AND lower(username) = lower($1)',
    [username]
  );
}

export async function login({ username, password, ip, remember = false }) {
  // Checked before the password is even looked at, so a guessing run is stopped
  // rather than merely slowed by bcrypt.
  await assertNotThrottled({ username, ip });

  const { rows } = await getPool().query(
    'SELECT * FROM admins WHERE username = $1 AND active = TRUE',
    [username]
  );
  const admin = rows[0];
  let ok = false;
  if (admin) {
    ok = await bcrypt.compare(password, admin.password_hash);
  } else {
    await timingDecoy(password);
  }

  if (!ok) {
    await withTx(async (client) => {
      await recordAttempt(client, { username, ip, success: false });
      // Failed attempts now leave a trace. Until this they left none at all, so
      // a password-guessing run was invisible in the audit trail.
      await writeAudit(client, {
        adminId: admin?.id ?? null,
        action: 'auth.login_failed',
        entity: 'admin',
        entityId: admin?.id ?? null,
        details: { username },
        ip,
      });
    });
    throw errors.unauthorized('Identifiants incorrects.');
  }

  // « Rester connecté » buys a longer session, nothing more. No password is
  // stored anywhere by the application — see the note in client/pages/Login.jsx.
  const ttlMs = remember
    ? config.rememberTtlDays * 24 * 3600 * 1000
    : config.sessionTtlHours * 3600 * 1000;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);

  await withTx(async (client) => {
    await client.query('INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1,$2,$3)', [
      token,
      admin.id,
      expiresAt,
    ]);
    await client.query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);
    await recordAttempt(client, { username, ip, success: true });
    await writeAudit(client, {
      adminId: admin.id,
      action: 'auth.login',
      entity: 'admin',
      entityId: admin.id,
      details: remember ? { remember: true } : null,
      ip,
    });
    await sweep(client, admin.username);
  });

  return { token, expiresAt: expiresAt.toISOString(), maxAgeMs: ttlMs, admin: publicAdmin(admin) };
}

export async function logout({ token, admin, ip }) {
  await withTx(async (client) => {
    await client.query('DELETE FROM sessions WHERE token = $1', [token]);
    await writeAudit(client, {
      adminId: admin.id, action: 'auth.logout', entity: 'admin', entityId: admin.id, ip,
    });
  });
}

export async function changePassword({ admin, currentPassword, newPassword, ip }) {
  const { rows } = await getPool().query('SELECT password_hash FROM admins WHERE id = $1', [admin.id]);
  const ok = rows[0] && (await bcrypt.compare(currentPassword, rows[0].password_hash));
  if (!ok) throw errors.unauthorized('Mot de passe actuel incorrect.');

  const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await withTx(async (client) => {
    await client.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, admin.id]);
    // Invalidate all existing sessions for this admin (force re-login).
    await client.query('DELETE FROM sessions WHERE admin_id = $1', [admin.id]);
    await writeAudit(client, {
      adminId: admin.id, action: 'auth.change_password', entity: 'admin', entityId: admin.id, ip,
    });
  });
}
