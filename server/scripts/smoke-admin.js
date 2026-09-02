// End-to-end smoke for the Utilisateurs, Paramètres and Rapports modules.
import './testCredentials.js';
import { startEmbeddedPg } from '../src/db/embedded.js';
import { initPool, closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '.smoke-admin-pgdata');
const PGPORT = 55547;
const APIPORT = 4110;
const base = `http://localhost:${APIPORT}`;

let embedded, server, token;
const out = [];
let failed = false;

const call = async (method, path, body, expect = 200) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== expect) { failed = true; out.push(`XX  ${method} ${path} -> ${res.status} (attendu ${expect}) ${JSON.stringify(json)}`); }
  else out.push(`OK  ${method} ${path} -> ${res.status}`);
  return json;
};
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failed = true;
  out.push(`${ok ? 'OK ' : 'XX '} ${label}: ${actual}${ok ? '' : ` (attendu ${expected})`}`);
};

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  const login = await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword });
  token = login.token;                 // admin1 (regular) — settings / reports / notifications
  const meId = login.admin.id;

  // The super-admin is the only account allowed to manage users.
  const superLogin = await call('POST', '/api/auth/login', { username: 'superadmin', password: config.superadminPassword });
  const superToken = superLogin.token;
  const superId = superLogin.admin.id;
  const callAs = async (tok, method, path, body, expect = 200) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status !== expect) { failed = true; out.push(`XX  ${method} ${path} [as] -> ${res.status} (attendu ${expect}) ${JSON.stringify(json)}`); }
    else out.push(`OK  ${method} ${path} [as] -> ${res.status}`);
    return json;
  };

  // ── Utilisateurs (super-admin only) ───────────────────────────────
  check('seed = 4 admins + 1 super', (await call('GET', '/api/admins')).admins.length, 5);
  check('super-admin a le rôle superadmin', superLogin.admin.role, 'superadmin');
  check('admin1 a le rôle admin', login.admin.role, 'admin');
  check('login renseigne last_login_at',
    (await call('GET', '/api/admins')).admins.find((a) => a.id === meId).last_login_at !== null, 'true');

  // A regular admin cannot manage accounts (403).
  await callAs(token, 'POST', '/api/admins', { username: 'nope', password: 'Motdepasse1', full_name: 'Nope' }, 403);
  await callAs(token, 'POST', `/api/admins/${meId}/password`, { newPassword: 'Whatever12' }, 403);

  const created = (await callAs(superToken, 'POST', '/api/admins', {
    username: 'admin5', password: 'Motdepasse1', full_name: 'Admin Test', office: 'algeria', email: 'a@b.dz',
  }, 201)).admin;
  check('utilisateur créé', created.username, 'admin5');
  check('nouvel utilisateur = rôle admin', created.role, 'admin');

  await callAs(superToken, 'POST', '/api/admins', { username: 'admin5', password: 'Motdepasse1', full_name: 'Doublon' }, 409);
  await callAs(superToken, 'POST', '/api/admins', { username: 'ab', password: 'court', full_name: 'X' }, 400);

  check('modification',
    (await callAs(superToken, 'PATCH', `/api/admins/${created.id}`, { full_name: 'Admin Modifié', office: 'china' })).admin.full_name,
    'Admin Modifié');

  // The new admin can log in, and loses their session when the super resets the password.
  const other = await call('POST', '/api/auth/login', { username: 'admin5', password: 'Motdepasse1' });
  check('nouvel utilisateur peut se connecter', Boolean(other.token), 'true');
  await callAs(superToken, 'POST', `/api/admins/${created.id}/password`, { newPassword: 'NouveauMotDePasse1' });
  const res = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${other.token}` } });
  check('session invalidée après reset', res.status, 401);

  // Guards: super cannot deactivate itself; the super-admin account is protected.
  await callAs(superToken, 'POST', `/api/admins/${superId}/active`, { active: false }, 409);
  check('désactivation',
    (await callAs(superToken, 'POST', `/api/admins/${created.id}/active`, { active: false })).admin.active, 'false');
  check('masqué par défaut',
    (await call('GET', '/api/admins')).admins.some((a) => a.id === created.id), 'false');
  check('visible avec includeInactive',
    (await call('GET', '/api/admins?includeInactive=true')).admins.some((a) => a.id === created.id), 'true');

  // ── Paramètres ────────────────────────────────────────────────────
  const s = await call('GET', '/api/settings');
  check('défauts société', s.settings.societe.nom, 'Swift Cargo');
  check('mise à jour',
    (await call('PUT', '/api/settings/societe', { nom: 'Swift Cargo DZ', adresse: '', telephone: '', pied_de_page: 'x' })).value.nom, 'Swift Cargo DZ');
  check('persistée', (await call('GET', '/api/settings')).settings.societe.nom, 'Swift Cargo DZ');
  await call('PUT', '/api/settings/inconnu', { x: 1 }, 404);
  await call('PUT', '/api/settings/alerts', { transferStaleDays: 5 }, 404); // key removed

  // ── Rapports ──────────────────────────────────────────────────────
  const caisse = (await call('GET', '/api/caisses')).caisses.find((c) => c.office === 'china');
  await call('POST', `/api/caisses/${caisse.id}/deposit`, { currency: 'DZD', amount: '50000' }, 201);
  await call('POST', `/api/caisses/${caisse.id}/withdraw`, { currency: 'DZD', amount: '20000' }, 201);

  const fin = await call('GET', '/api/reports/financial?period=mois&currency=DZD');
  check('rapport entrées', fin.entrees, '50000.00');
  check('rapport net', fin.net, '30000.00');

  const rel = await call('GET', `/api/reports/caisse/${caisse.id}?period=mois&currency=DZD`);
  check('relevé : ouverture', rel.soldeOuverture, '0');
  check('relevé : clôture', rel.soldeCloture, '30000.00');
  check('relevé : 2 lignes', rel.entries.length, 2);
  check('relevé : solde progressif', rel.entries[rel.entries.length - 1].solde, '30000.00');

  await call('GET', '/api/reports/orders?period=mois&currency=DZD');
  await call('GET', '/api/reports/losses?period=mois');
  await call('GET', '/api/reports/caisse/99999?period=mois', null, 404);

  // ── Notifications (another account's activity) ────────────────────
  const bearer = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
  const asJson = (r) => r.json();
  // admin1 (the module `token`) has already done deposits/withdrawals above.
  // admin2 now does something; admin1 should be notified, and vice-versa.
  const t2 = (await call('POST', '/api/auth/login', { username: 'admin2', password: config.seedAdminPassword })).token;
  await fetch(`${base}/api/fournisseurs`, { method: 'POST', headers: bearer(t2), body: JSON.stringify({ name: 'Fournisseur Notif' }) });

  const n1 = await fetch(`${base}/api/notifications/count`, { headers: bearer(token) }).then(asJson);
  check('admin1 a des notifications non lues', n1.unread > 0, 'true');
  const feed1 = await fetch(`${base}/api/notifications?limit=20`, { headers: bearer(token) }).then(asJson);
  check('notifications = activité des autres uniquement',
    feed1.notifications.every((n) => n.admin_name !== 'Admin Chine 1'), 'true');
  check("l'action d'admin2 apparaît",
    feed1.notifications.some((n) => n.admin_name === 'Admin Chine 2'), 'true');

  await fetch(`${base}/api/notifications/seen`, { method: 'POST', headers: bearer(token) });
  const n1b = await fetch(`${base}/api/notifications/count`, { headers: bearer(token) }).then(asJson);
  check('badge remis à zéro après lecture', n1b.unread, 0);

  // Alerts endpoint is gone.
  await call('GET', '/api/alerts', null, 404);

  // ── Recherche ─────────────────────────────────────────────────────
  const search = await call('GET', '/api/search?q=Admin');
  check('recherche répond', Array.isArray(search.groups), 'true');

  console.log(out.join('\n'));
  console.log(failed ? '\nSMOKE-ADMIN FAILED' : '\nSMOKE-ADMIN PASSED');
} catch (e) {
  console.error('SMOKE-ADMIN ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
