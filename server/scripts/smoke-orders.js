// End-to-end HTTP smoke for orders + office caisses + person accounts + auto-post.
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
const dataDir = join(__dirname, '..', '.smoke3-pgdata');
const PGPORT = 55535;
const APIPORT = 4103;
const base = `http://localhost:${APIPORT}`;

let embedded, server, token;
const out = [];
const call = async (method, path, body, expect = 200) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  out.push(`${ok ? 'OK ' : 'XX '} ${method} ${path} -> ${res.status}${ok ? '' : ` (attendu ${expect}) ${JSON.stringify(json)}`}`);
  return json;
};
const chk = (label, got, want) => out.push(`${String(got) === String(want) ? 'OK ' : 'XX '} ${label} = ${got} [attendu ${want}]`);

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  token = (await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword })).token;

  const { caisses } = await call('GET', '/api/caisses');
  chk('nombre de caisses (2 bureaux)', caisses.length, 2);
  const algeria = caisses.find((c) => c.office === 'algeria');

  const f = (await call('POST', '/api/fournisseurs', { name: 'Fourn. Ordre' }, 201)).fournisseur;
  const p1 = (await call('POST', '/api/passagers', { full_name: 'Passager A' }, 201)).passager;
  const p2 = (await call('POST', '/api/passagers', { full_name: 'Passager B' }, 201)).passager;

  // Order with 2 bons (2 passagers), fees 5000 + 3000 DZD
  const order = (await call('POST', '/api/orders', {
    fournisseurId: f.id,
    bons: [
      // The fee is DERIVED from the lines (unit price x quantity), not taken from
      // `transportFee` - so the lines must carry a price: 10 x 500 and 4 x 750.
      { passagerId: p1.id, transportCurrency: 'DZD', lines: [{ designation: 'Colis A', measure: 'quantite', value: '10', unitPrice: '500' }] },
      { passagerId: p2.id, transportCurrency: 'DZD', lines: [{ designation: 'Colis B', measure: 'quantite', value: '4', unitPrice: '750' }] },
    ],
  }, 201)).order;
  out.push(`Ordre créé: ${order.reference}, statut ${order.status}, ${order.bons.length} bons`);
  chk('total frais ordre', order.totals.transport_fee, 8000);

  // Fournisseur now owes 8000 (receivable => balance -8000)
  let facc = (await call('GET', `/api/fournisseurs/${f.id}/account`)).account;
  chk('solde fournisseur (doit -8000)', facc.balances.find((b) => b.currency_code === 'DZD')?.balance, '-8000.00');

  const [b1, b2] = order.bons;
  for (const b of [b1, b2]) {
    await call('POST', `/api/bons/${b.id}/advance`, {}); // -> en_transit
    await call('POST', `/api/bons/${b.id}/advance`, {}); // -> arrive
  }
  const arr = (await call('GET', `/api/orders/${order.id}`)).order;
  chk('statut ordre après arrivée des 2 bons', arr.status, 'arrivee');

  await call('POST', `/api/bons/${b1.id}/settle`, {}); // payment 5000
  const closed = (await call('POST', `/api/bons/${b2.id}/settle`, {})); // payment 3000
  const ord2 = (await call('GET', `/api/orders/${order.id}`)).order;
  chk('statut ordre après règlement', ord2.status, 'cloturee');

  // Passager A is owed 5000
  let pacc = (await call('GET', `/api/passagers/${p1.id}/account`)).account;
  chk('solde passager A (dû +5000)', pacc.balances.find((b) => b.currency_code === 'DZD')?.balance, '5000.00');

  // Collect 5000 fee from fournisseur into Algeria caisse
  await call('POST', `/api/bons/${b1.id}/collect-fee`, { caisseId: algeria.id, amount: '5000' });
  facc = (await call('GET', `/api/fournisseurs/${f.id}/account`)).account;
  chk('solde fournisseur après encaissement 5000', facc.balances.find((b) => b.currency_code === 'DZD')?.balance, '-3000.00');

  // Pay passager A from Algeria caisse
  await call('POST', `/api/bons/${b1.id}/pay-passager`, { caisseId: algeria.id });
  pacc = (await call('GET', `/api/passagers/${p1.id}/account`)).account;
  chk('solde passager A après paiement', pacc.balances.find((b) => b.currency_code === 'DZD')?.balance, '0.00');

  // Algeria caisse DZD = +5000 (fee) - 5000 (payment) = 0
  const alg = (await call('GET', `/api/caisses/${algeria.id}`)).caisse;
  chk('solde caisse Algérie DZD', alg.balances.find((b) => b.currency_code === 'DZD')?.balance, '0.00');

  console.log(out.join('\n'));
  console.log(out.every((l) => !l.startsWith('XX')) ? '\nSMOKE-ORDERS PASSED' : '\nSMOKE-ORDERS FAILED');
} catch (e) {
  console.error('SMOKE-ORDERS ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
