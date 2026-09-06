// Smoke: inter-office cash transfer (two legs) — send from China caisse, confirm
// receipt at Algeria caisse; assert both balances and the transfer status.
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
const dataDir = join(__dirname, '..', '.smoke4-pgdata');
const PGPORT = 55537, APIPORT = 4104, base = `http://localhost:${APIPORT}`;

let embedded, server, token;
const out = [];
const call = async (m, p, b, expect = 200) => {
  const res = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const j = await res.json().catch(() => ({}));
  out.push(`${res.status === expect ? 'OK ' : 'XX '} ${m} ${p} -> ${res.status}${res.status === expect ? '' : ` ${JSON.stringify(j)}`}`);
  return j;
};
const chk = (l, g, w) => out.push(`${String(g) === String(w) ? 'OK ' : 'XX '} ${l} = ${g} [attendu ${w}]`);
const dzd = (c) => c.balances.find((b) => b.currency_code === 'DZD').balance;

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  token = (await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword })).token;
  const { caisses } = await call('GET', '/api/caisses');
  const china = caisses.find((c) => c.office === 'china');
  const algeria = caisses.find((c) => c.office === 'algeria');

  await call('POST', `/api/caisses/${china.id}/deposit`, { currency: 'DZD', amount: '10000' }, 201);

  const t = (await call('POST', '/api/office-transfers', { fromCaisseId: china.id, toCaisseId: algeria.id, currency: 'DZD', amount: '4000' }, 201)).transfer;
  out.push(`Transfert créé: ${t.reference}, statut ${t.status}`);
  // Sending moves nothing at all now — both tills must be untouched until the
  // destination confirms.
  chk('caisse Chine après envoi (inchangée)', dzd((await call('GET', `/api/caisses/${china.id}`)).caisse), '10000.00');
  chk('caisse Algérie avant réception', dzd((await call('GET', `/api/caisses/${algeria.id}`)).caisse), '0.00');

  await call('POST', `/api/office-transfers/${t.id}/receive`, {});
  chk('caisse Chine après réception', dzd((await call('GET', `/api/caisses/${china.id}`)).caisse), '6000.00');
  chk('caisse Algérie après réception', dzd((await call('GET', `/api/caisses/${algeria.id}`)).caisse), '4000.00');
  const list = (await call('GET', '/api/office-transfers?status=recu')).transfers;
  chk('transfert marqué reçu', list[0]?.status, 'recu');

  // Guard: receiving again is rejected
  await call('POST', `/api/office-transfers/${t.id}/receive`, {}, 409);

  console.log(out.join('\n'));
  console.log(out.every((l) => !l.startsWith('XX')) ? '\nSMOKE-TRANSFERS PASSED' : '\nSMOKE-TRANSFERS FAILED');
} catch (e) {
  console.error('SMOKE-TRANSFERS ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
