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
  const f = (await call('POST', '/api/fournisseurs', { name: 'Fournisseur Dash', city: 'Guangzhou' }, 201)).fournisseur;
  const p = (await call('POST', '/api/passagers', { type: 'regular', full_name: 'Passager Dash' }, 201)).passager;

  // Cash in, so Entrées/Net are non-zero.
  await call('POST', `/api/caisses/${caisse.id}/deposit`, { currency: 'DZD', amount: '100000', note: 'Fonds' }, 201);
  await call('POST', `/api/caisses/${caisse.id}/withdraw`, { currency: 'DZD', amount: '25000', note: 'Frais' }, 201);

  // Bon A — carried all the way to fully settled (should land in "Terminé").
  const a = (await call('POST', '/api/bons', {
    fournisseurId: f.id, passagerId: p.id, transportCurrency: 'DZD', transportFee: '5000',
    lines: [{ designation: 'Cartons', quantity: '10', unit: 'carton', weight_kg: '50', cbm: '0.8' }],
  }, 201)).bon;
  await call('POST', `/api/bons/${a.id}/advance`, {});
  await call('POST', `/api/bons/${a.id}/advance`, {});
  await call('POST', `/api/bons/${a.id}/reconcile`, {
    lines: [{ lineId: a.lines[0].id, receivedQuantity: '10', lossValue: '0' }],
  });
  await call('POST', `/api/bons/${a.id}/settle`, {});
  await call('POST', `/api/bons/${a.id}/collect-fee`, { caisseId: caisse.id });
  await call('POST', `/api/bons/${a.id}/pay-passager`, { caisseId: caisse.id });

  // Bon B — settled but the passager has NOT been paid (stays at "Réglé").
  const b = (await call('POST', '/api/bons', {
    fournisseurId: f.id, passagerId: p.id, transportCurrency: 'DZD', transportFee: '3000',
    lines: [{ designation: 'Sacs', quantity: '4', unit: 'pièce', weight_kg: '20', cbm: '0.2' }],
  }, 201)).bon;
  await call('POST', `/api/bons/${b.id}/advance`, {});
  await call('POST', `/api/bons/${b.id}/advance`, {});
  await call('POST', `/api/bons/${b.id}/settle`, {});

  // Bon C — left at "En attente".
  await call('POST', '/api/bons', {
    fournisseurId: f.id, transportCurrency: 'DZD', transportFee: '0',
    lines: [{ designation: 'Divers', quantity: '2', unit: 'kg', weight_kg: '2', cbm: '0.01' }],
  }, 201);

  // ── the assertions ────────────────────────────────────────────────
  const ov = await call('GET', '/api/dashboard/overview?period=mois&currency=DZD');

  const steps = Object.fromEntries(ov.pipeline.steps.map((s) => [s.key, s.count]));
  check('pipeline en_attente', steps.en_attente, 1);
  // Bons A (fully settled) and B (settled, passager unpaid) are both 'regle' now
  // that the derived "Terminé" step is gone.
  check('pipeline regle', steps.regle, 2);
  check('pipeline termine supprimé', steps.termine, undefined);
  check('pipeline total', ov.pipeline.total, 3);
  check('pipeline = 4 étapes', ov.pipeline.steps.length, 4);

  // Entrées: 100000 deposit + 5000 fee collected. Dépenses: 25000 + 5000 paid.
  // Conversions/transfers are excluded by design; there are none here anyway.
  check('financier entrées', ov.financial.entrees.value, '105000.00');
  check('financier dépenses', ov.financial.depenses.value, '30000.00');
  check('financier net', ov.financial.net.value, '75000.00');
  check('net = entrées - dépenses', ov.financial.net.value,
    (Number(ov.financial.entrees.value) - Number(ov.financial.depenses.value)).toFixed(2));

  // Chiffre d'affaires: only the 5000 actually collected, not the 8000 billed.
  check("CA argent (encaissé)", ov.revenue.money.value, '5000.00');
  check('CA poids kg', ov.revenue.quantity.weightKg, '72.000');
  const units = Object.fromEntries(ov.revenue.quantity.byUnit.map((u) => [u.unit, u.quantity]));
  check('CA quantité par unité: carton', units.carton, '10.000');
  check('CA quantité par unité: pièce', units['pièce'], '4.000');
  check('CA quantité par unité: kg', units.kg, '2.000');

  check('séries financières remplies', ov.financial.entrees.series.length, 12);
  check('bons récents', ov.recentBons.length, 3);
  check("activité récente non vide", ov.activity.length > 0, 'true');
  check('overview ne renvoie plus alerts', 'alerts' in ov, false);

  // Period switching must not error on any allowed value.
  for (const period of ['jour', 'semaine', 'mois', 'trimestre', 'annee']) {
    await call('GET', `/api/dashboard/financial?period=${period}&currency=DZD`);
  }
  await call('GET', '/api/dashboard/financial?period=decennie', null, 400);

  // Per-card tile endpoint (the 3-dots period picker). Bons actifs = not 'regle':
  // A and B are réglé, only C remains → 1.
  const tileBons = await call('GET', '/api/dashboard/tile/bons?period=semaine&currency=DZD');
  check('tile bons: valeur = bons actifs', tileBons.value, '1');
  const tileRev = await call('GET', '/api/dashboard/tile/revenue?period=mois&currency=DZD');
  check('tile revenue: mesures argent + quantité', Boolean(tileRev.money && tileRev.quantity), 'true');
  await call('GET', '/api/dashboard/tile/inconnu?period=mois', null, 400);

  // Sync status must carry the new fields the dashboard card needs.
  const sync = await call('GET', '/api/sync/status');
  check('sync expose online', typeof sync.online !== 'undefined', 'true');
  check('sync expose oldestPendingAt', 'oldestPendingAt' in sync, 'true');

  // Donut
  check('donut total = quantité stock', ov.stockByCategory.total, '0.000');

  console.log(out.join('\n'));
  console.log(failed ? '\nSMOKE-DASHBOARD FAILED' : '\nSMOKE-DASHBOARD PASSED');
} catch (e) {
  console.error('SMOKE-DASHBOARD ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
