// End-to-end smoke for the dashboard aggregates. Builds a small but
// real dataset (fournisseur, passager, bon, cash movements), then asserts the
// dashboard numbers derived from it — in particular the 5-step pipeline, whose
// last step "Terminé" is derived from money being fully settled, not stored.
import './testCredentials.js';
import { startEmbeddedPg } from '../src/db/embedded.js';
import { initPool, closePool, getPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '.smoke-dash-pgdata');
const PGPORT = 55545;
const APIPORT = 4108;
const base = `http://localhost:${APIPORT}`;

// Le code de sortie DIT ce qui s'est passé. Avant, ce script se terminait
// par process.exit(0) dans le finally : il annonçait « réussi » au shell même
// quand une assertion avait échoué, même quand Postgres n'avait pas démarré.
// Un test qui ne peut pas échouer ne teste rien. Il vaut 1 par défaut, et ne
// descend à 0 que si la ligne de verdict ci-dessous dit PASSED.
let exitCode = 1;

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
  if (res.status !== expect) {
    failed = true;
    out.push(`XX  ${method} ${path} -> ${res.status} (attendu ${expect}) ${JSON.stringify(json)}`);
  } else {
    out.push(`OK  ${method} ${path} -> ${res.status}`);
  }
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

  token = (await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword })).token;

  const caisse = (await call('GET', '/api/caisses')).caisses.find((c) => c.office === 'china');
  const f = (await call('POST', '/api/people', { name: 'Fournisseur Dash', isFournisseur: true }, 201)).person;
  const p = (await call('POST', '/api/people', { name: 'Passager Dash', isPassager: true, passagerType: 'regular' }, 201)).person;

  // Cash in, so Entrées/Net are non-zero.
  await call('POST', `/api/caisses/${caisse.id}/deposit`, { currency: 'DZD', amount: '100000', note: 'Fonds' }, 201);
  await call('POST', `/api/caisses/${caisse.id}/withdraw`, { currency: 'DZD', amount: '25000', note: 'Frais' }, 201);

  // La marchandise entre TOUJOURS par un bon fournisseur : c'est là qu'elle est
  // reçue, facturée et mise en stock. Les bons passagers y puisent ensuite.
  // Facturé au fournisseur : 10 × 500 + 50 kg × 100 = 10 000.
  const order = (await call('POST', '/api/orders', {
    fournisseurId: f.id,
    bons: [{ transportCurrency: 'DZD', lines: [
      { designation: 'Cartons', measure: 'quantite', value: '10', unit: 'carton', unitPrice: '500' },
      { designation: 'Riz', measure: 'poids', value: '50', unitPrice: '100' },
    ] }],
  }, 201)).order;
  const crate = order.bons[0];
  const lots = (await call('GET', '/api/bons/allocatable')).lines;
  const lotCartons = lots.find((l) => l.designation === 'Cartons');
  const lotRiz = lots.find((l) => l.designation === 'Riz');

  // Bon A — porté jusqu'au bout : réglé, puis le passager payé (3 000).
  const a = (await call('POST', '/api/bons', {
    passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lotCartons.line_id, measure: 'quantite', value: '10', unitPrice: '300' }],
  }, 201)).bon;
  await call('POST', `/api/bons/${a.id}/advance`, {});
  await call('POST', `/api/bons/${a.id}/advance`, {});
  await call('POST', `/api/bons/${a.id}/reconcile`, {
    lines: [{ lineId: a.lines[0].id, receivedQuantity: '10' }],
  });
  await call('POST', `/api/bons/${a.id}/settle`, {});
  await call('POST', `/api/bons/${a.id}/pay-passager`, { caisseId: caisse.id });

  // Le fournisseur règle 5 000 des 10 000 facturés — sur SON bon, le seul qui
  // porte une dette.
  await call('POST', `/api/bons/${crate.id}/collect-fee`, { caisseId: caisse.id, amount: '5000' });

  // Bon B — laissé « En attente ».
  await call('POST', '/api/bons', {
    passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lotRiz.line_id, measure: 'poids', value: '50', unitPrice: '40' }],
  }, 201);

  // ── the assertions ────────────────────────────────────────────────
  const ov = await call('GET', '/api/dashboard/overview?period=mois&currency=DZD');

  const steps = Object.fromEntries(ov.pipeline.steps.map((s) => [s.key, s.count]));
  check('pipeline en_attente', steps.en_attente, 1);
  check('pipeline regle', steps.regle, 1);
  check('pipeline termine supprimé', steps.termine, undefined);
  // Le bon fournisseur n'y est pas : le pipeline suit les bons PASSAGERS.
  check('pipeline total (bons passagers seulement)', ov.pipeline.total, 2);
  check('pipeline = 4 étapes', ov.pipeline.steps.length, 4);

  // Entrées : dépôt 100 000 + 5 000 encaissés. Dépenses : 25 000 + 3 000 payés
  // au passager. Conversions et transferts sont exclus par principe.
  check('financier entrées', ov.financial.entrees.value, '105000.00');
  check('financier dépenses', ov.financial.depenses.value, '28000.00');
  check('financier net', ov.financial.net.value, '77000.00');
  check('net = entrées - dépenses', ov.financial.net.value,
    (Number(ov.financial.entrees.value) - Number(ov.financial.depenses.value)).toFixed(2));

  // Chiffre d'affaires : seulement les 5 000 encaissés, pas les 10 000 facturés.
  check("CA argent (encaissé)", ov.revenue.money.value, '5000.00');
  // Volumes = marchandise REÇUE (bons fournisseurs). Les compter aussi sur les
  // bons passagers compterait deux fois les mêmes cartons.
  check('CA poids kg', ov.revenue.quantity.weightKg, '50.000');
  const units = Object.fromEntries(ov.revenue.quantity.byUnit.map((u) => [u.unit, u.quantity]));
  check('CA quantité par unité: carton', units.carton, '10.000');

  check('séries financières remplies', ov.financial.entrees.series.length, 12);
  check('bons récents', ov.recentBons.length, 2);
  check("activité récente non vide", ov.activity.length > 0, 'true');
  check('overview ne renvoie plus alerts', 'alerts' in ov, false);

  // Period switching must not error on any allowed value.
  for (const period of ['jour', 'semaine', 'mois', 'trimestre', 'annee']) {
    await call('GET', `/api/dashboard/financial?period=${period}&currency=DZD`);
  }
  await call('GET', '/api/dashboard/financial?period=decennie', null, 400);

  // Per-card tile endpoint (the 3-dots period picker). Bons actifs = bons
  // passagers non réglés : A est réglé, B attend → 1.
  const tileBons = await call('GET', '/api/dashboard/tile/bons?period=semaine&currency=DZD');
  check('tile bons: valeur = bons actifs', tileBons.value, '1');
  const tileRev = await call('GET', '/api/dashboard/tile/revenue?period=mois&currency=DZD');
  check('tile revenue: mesures argent + quantité', Boolean(tileRev.money && tileRev.quantity), 'true');
  await call('GET', '/api/dashboard/tile/inconnu?period=mois', null, 400);

  // Sync status must carry the new fields the dashboard card needs.
  const sync = await call('GET', '/api/sync/status');
  check('sync expose online', typeof sync.online !== 'undefined', 'true');
  check('sync expose oldestPendingAt', 'oldestPendingAt' in sync, 'true');

  // Donut : la marchandise reçue est en stock — 10 cartons, partis de Chine avec
  // le passager et arrives en Algerie, donc toujours comptes. Le riz est mesure
  // au poids, sa quantite est 0.
  check('donut total = quantité stock', ov.stockByCategory.total, '10.000');

  console.log(out.join('\n'));
  const passed = !(failed);
  console.log(passed ? '\nSMOKE-DASHBOARD PASSED' : '\nSMOKE-DASHBOARD FAILED');
  exitCode = passed ? 0 : 1;
} catch (e) {
  console.error('SMOKE-DASHBOARD ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(exitCode);
}
