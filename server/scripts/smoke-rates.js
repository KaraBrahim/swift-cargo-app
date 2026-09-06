// Smoke: exchange rates — the ALP link, quoted pairs and the history lookup,
// exercised over HTTP against a throwaway database.
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
const dataDir = join(__dirname, '..', '.smoke5-pgdata');
const PGPORT = 55539, APIPORT = 4106, base = `http://localhost:${APIPORT}`;

let embedded, server, token;
const out = [];
const call = async (m, p, b, expect = 200) => {
  const res = await fetch(base + p, {
    method: m,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  out.push(`${res.status === expect ? 'OK ' : 'XX '} ${m} ${p} -> ${res.status}${res.status === expect ? '' : ` ${JSON.stringify(j)}`}`);
  return j;
};
const chk = (l, g, w) => out.push(`${String(g) === String(w) ? 'OK ' : 'XX '} ${l} = ${g} [attendu ${w}]`);
const today = new Date().toISOString().slice(0, 10);

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  token = (await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword })).token;
  const cur = () => call('GET', '/api/currencies').then((r) => r.currencies);
  const of = (list, code) => list.find((c) => c.code === code);

  // ── the ALP link, on by default ──
  chk('ALP lié au CNY par défaut', of(await cur(), 'ALP').linked_to, 'CNY');
  await call('POST', '/api/rates', { currencyCode: 'CNY', dzdPerUnit: '31.5' }, 201);
  const afterCny = await cur();
  chk('CNY modifié', Number(of(afterCny, 'CNY').dzd_per_unit), 31.5);
  chk('ALP suit dans la foulée', Number(of(afterCny, 'ALP').dzd_per_unit), 31.5);
  await call('POST', '/api/rates', { currencyCode: 'ALP', dzdPerUnit: '29' }, 409);

  // ── unlinked, ALP goes its own way ──
  await call('PUT', '/api/settings/taux', { alp_suit_cny: false });
  await call('POST', '/api/rates', { currencyCode: 'ALP', dzdPerUnit: '29' }, 201);
  const unlinked = await cur();
  chk('ALP indépendant', Number(of(unlinked, 'ALP').dzd_per_unit), 29);
  chk('CNY inchangé', Number(of(unlinked, 'CNY').dzd_per_unit), 31.5);
  chk('plus de badge de lien', String(of(unlinked, 'ALP').linked_to), 'null');

  // ── a pair: computed, then quoted ──
  await call('POST', '/api/rates', { currencyCode: 'USD', dzdPerUnit: '252' }, 201);
  await call('POST', '/api/pairs', { fromCode: 'USD', toCode: 'CNY' }, 201);
  const derived = (await call('GET', '/api/pairs')).pairs[0];
  chk('paire calculée', derived.mode, 'derive');
  chk('valeur suggérée (252 / 31.5)', Number(derived.rate).toFixed(2), '8.00');

  await call('POST', '/api/pairs/USD/CNY/rate', { unitsPerUnit: '8.20' }, 201);
  const quoted = (await call('GET', '/api/pairs')).pairs[0];
  chk('paire manuelle', quoted.mode, 'manuel');
  chk('taux inscrit', Number(quoted.rate).toFixed(2), '8.20');
  chk('le calculé reste visible', Number(quoted.derived_rate).toFixed(2), '8.00');

  // ── and it is what the caisse charges ──
  const caisses = (await call('GET', '/api/caisses')).caisses;
  const china = caisses.find((c) => c.office === 'china');
  await call('POST', `/api/caisses/${china.id}/deposit`, { currency: 'USD', amount: '100' }, 201);
  const conv = await call('POST', `/api/caisses/${china.id}/convert`, { fromCurrency: 'USD', toCurrency: 'CNY', amount: '100' }, 201);
  chk('100 USD au taux de la paire', conv.conversion.to_amount, '820.00');
  chk('la ligne reste cohérente', (Number(conv.conversion.dzd_value) / Number(conv.conversion.to_rate_dzd)).toFixed(2), '820.00');

  // ── back to computed ──
  await call('POST', '/api/pairs/USD/CNY/reset', {});
  chk('recalculée depuis le DZD', Number((await call('GET', '/api/pairs')).pairs[0].rate).toFixed(2), '8.00');

  // ── history ──
  const day = await call('GET', `/api/rates/lookup?from=USD&to=DZD&date=${today}`);
  chk('taux du jour USD/DZD', Number(day.rate).toFixed(2), '252.00');
  const old = await call('GET', '/api/rates/lookup?from=USD&to=DZD&date=2020-01-01');
  chk('avant tout historique', String(old.rate), 'null');
  const range = await call('GET', `/api/rates/lookup?from=CNY&to=DZD&start=2026-01-01&end=${today}`);
  chk('moyenne calculée', range.average != null, 'true');
  chk('points relevés', range.points.length >= 2, 'true');
  await call('GET', '/api/rates/lookup?from=USD&to=USD&date=2026-01-01', null, 400);

  console.log(out.join('\n'));
  console.log(out.every((l) => !l.startsWith('XX')) ? '\nSMOKE-RATES PASSED' : '\nSMOKE-RATES FAILED');
} catch (e) {
  console.error('SMOKE-RATES ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
