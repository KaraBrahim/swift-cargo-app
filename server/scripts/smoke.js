// End-to-end HTTP smoke test: boots the real app against an embedded DB, then
// drives it through the actual REST API exactly like the front-end will.
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
const dataDir = join(__dirname, '..', '.smoke-pgdata');
const PGPORT = 55531;
const APIPORT = 4100;
const base = `http://localhost:${APIPORT}`;

let embedded, server, token;
const results = [];
const call = async (method, path, body, expect = 200) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  results.push(`${ok ? 'OK ' : 'XX '} ${method} ${path} -> ${res.status}${ok ? '' : ` (attendu ${expect})`}`);
  if (!ok) results.push('     ' + JSON.stringify(json));
  return json;
};

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  await call('GET', '/api/health');
  await call('POST', '/api/auth/login', { username: 'nope', password: 'bad' }, 401);
  const login = await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword });
  token = login.token;

  const { caisses } = await call('GET', '/api/caisses');
  const caisseId = caisses.find((c) => c.kind === 'office').id;

  await call('GET', '/api/currencies');
  await call('POST', '/api/rates', { currencyCode: 'CNY', dzdPerUnit: '30.5', note: 'smoke' }, 201);
  await call('POST', `/api/caisses/${caisseId}/deposit`, { currency: 'CNY', amount: '1000' }, 201);
  await call('POST', `/api/caisses/${caisseId}/deposit`, { currency: 'CNY', amount: '-5' }, 400); // validation
  await call('POST', `/api/caisses/${caisseId}/convert`, { fromCurrency: 'CNY', toCurrency: 'DZD', amount: '1000' }, 201);
  await call('POST', `/api/caisses/${caisseId}/withdraw`, { currency: 'DZD', amount: '999999' }, 409); // insufficient
  const detail = await call('GET', `/api/caisses/${caisseId}`);
  await call('GET', `/api/caisses/${caisseId}/conversions`);
  await call('GET', '/api/audit');

  const dzd = detail.caisse.balances.find((b) => b.currency_code === 'DZD');
  results.push(`\nSolde DZD après conversion (taux 30,5) = ${dzd.balance}  [attendu 30500.00]`);

  console.log(results.join('\n'));
  console.log(results.every((r) => !r.startsWith('XX')) ? '\nSMOKE PASSED' : '\nSMOKE FAILED');
} catch (e) {
  console.error('SMOKE ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
