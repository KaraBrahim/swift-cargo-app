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

// Le code de sortie DIT ce qui s'est passé. Avant, ce script se terminait
// par process.exit(0) dans le finally : il annonçait « réussi » au shell même
// quand une assertion avait échoué, même quand Postgres n'avait pas démarré.
// Un test qui ne peut pas échouer ne teste rien. Il vaut 1 par défaut, et ne
// descend à 0 que si la ligne de verdict ci-dessous dit PASSED.
let exitCode = 1;

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

  const f = (await call('POST', '/api/people', { name: 'Fourn. Ordre', isFournisseur: true }, 201)).person;
  const p1 = (await call('POST', '/api/people', { name: 'Passager A', isPassager: true }, 201)).person;
  const p2 = (await call('POST', '/api/people', { name: 'Passager B', isPassager: true }, 201)).person;

  // Le bon fournisseur reçoit la marchandise : la caisse dans laquelle elle
  // attend qu'un passager l'emporte. Le montant facturé est DÉRIVÉ des lignes
  // (prix x quantité) : 10 x 500 et 4 x 750.
  const order = (await call('POST', '/api/orders', {
    fournisseurId: f.id,
    bons: [{ transportCurrency: 'DZD', lines: [
      { designation: 'Colis A', measure: 'quantite', value: '10', unitPrice: '500' },
      { designation: 'Colis B', measure: 'quantite', value: '4', unitPrice: '750' },
    ] }],
  }, 201)).order;
  const crate = order.bons[0];
  out.push(`Ordre créé: ${order.reference}, statut ${order.status}, ${order.bons.length} bon`);
  // Chaine a echelle fixe depuis l'audit : les totaux d'un ordre ne sont plus
  // additionnes en doubles cote serveur.
  chk('total frais ordre', order.totals.transport_fee, '8000.00');

  // Fournisseur now owes 8000 (receivable => balance -8000)
  let facc = (await call('GET', `/api/people/${f.id}/account`)).account;
  chk('solde fournisseur (doit -8000)', facc.balances.find((b) => b.currency_code === 'DZD')?.balance, '-8000.00');

  // Deux passagers se partagent la marchandise : un lot chacun. Le statut de
  // l'ordre suit ces bons-là — ce sont eux qui voyagent.
  const lots = (await call('GET', '/api/bons/allocatable')).lines;
  const lotA = lots.find((l) => l.designation === 'Colis A');
  const lotB = lots.find((l) => l.designation === 'Colis B');
  chk('lots disponibles après réception', lots.length, 2);

  const b1 = (await call('POST', '/api/bons', {
    passagerId: p1.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lotA.line_id, measure: 'quantite', value: '10', unitPrice: '500' }],
  }, 201)).bon;
  const b2 = (await call('POST', '/api/bons', {
    passagerId: p2.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lotB.line_id, measure: 'quantite', value: '4', unitPrice: '750' }],
  }, 201)).bon;
  chk('un bon passager n\u2019appartient \u00e0 aucun fournisseur', b1.fournisseur_id, null);

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
  let pacc = (await call('GET', `/api/people/${p1.id}/account`)).account;
  chk('solde passager A (dû +5000)', pacc.balances.find((b) => b.currency_code === 'DZD')?.balance, '5000.00');

  // Le fournisseur règle 5 000 des 8 000 : sur SON bon, le seul qui porte une
  // dette — un bon passager n'a jamais rien facturé.
  await call('POST', `/api/bons/${crate.id}/collect-fee`, { caisseId: algeria.id, amount: '5000' });
  await call('POST', `/api/bons/${b1.id}/collect-fee`, { caisseId: algeria.id, amount: '100' }, 409);
  facc = (await call('GET', `/api/people/${f.id}/account`)).account;
  chk('solde fournisseur après encaissement 5000', facc.balances.find((b) => b.currency_code === 'DZD')?.balance, '-3000.00');

  // Pay passager A from Algeria caisse
  await call('POST', `/api/bons/${b1.id}/pay-passager`, { caisseId: algeria.id });
  pacc = (await call('GET', `/api/people/${p1.id}/account`)).account;
  chk('solde passager A après paiement', pacc.balances.find((b) => b.currency_code === 'DZD')?.balance, '0.00');

  // Algeria caisse DZD = +5000 (fee) - 5000 (payment) = 0
  const alg = (await call('GET', `/api/caisses/${algeria.id}`)).caisse;
  chk('solde caisse Algérie DZD', alg.balances.find((b) => b.currency_code === 'DZD')?.balance, '0.00');

  console.log(out.join('\n'));
  const passed = out.every((l) => !l.startsWith('XX'));
  console.log(passed ? '\nSMOKE-ORDERS PASSED' : '\nSMOKE-ORDERS FAILED');
  exitCode = passed ? 0 : 1;
} catch (e) {
  console.error('SMOKE-ORDERS ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(exitCode);
}
