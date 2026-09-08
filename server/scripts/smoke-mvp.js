// End-to-end HTTP smoke for the MVP modules: fournisseurs, passagers, stock,
// and the full bon lifecycle (create -> advance -> reconcile -> settle).
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
const dataDir = join(__dirname, '..', '.smoke2b-pgdata');
const PGPORT = 55561;
const APIPORT = 4132;
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

try {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  embedded = await startEmbeddedPg({ dataDir, port: PGPORT, persistent: false });
  initPool(embedded.connectionString);
  await runMigrations();
  await runSeed();
  await new Promise((r) => (server = createApp().listen(APIPORT, r)));

  token = (await call('POST', '/api/auth/login', { username: 'admin1', password: config.seedAdminPassword })).token;

  const f = (await call('POST', '/api/people', { name: 'Fournisseur Test', phone: '0550', isFournisseur: true }, 201)).person;
  const p = (await call('POST', '/api/people', { name: 'Passager Test', phone: '0770', isPassager: true, passagerType: 'regular' }, 201)).person;

  const cat = (await call('POST', '/api/stock/categories', { name: 'Électronique' }, 201)).category;
  const item = (await call('POST', '/api/stock/items', { category_id: cat.id, name: 'Téléphone' }, 201)).item;
  // Stock is held per office in stock_levels now, and the route that sets an
  // absolute level is /level (it was /inventory before the office split).
  await call('POST', `/api/stock/items/${item.id}/level`, { office: 'china', quantity: '97', weight_kg: '29.1', cbm: '0.194', note: 'Comptage' }, 201);
  // Looked up by id, not by ILIKE '%Tel%' — that never matched « Téléphone »
  // (é is not e), which is why this line used to print undefined.
  const levels = (await call('GET', '/api/stock/levels?office=china')).items;
  const levelAfter = levels.find((l) => l.id === item.id);
  out.push(`Stock après inventaire: quantité = ${levelAfter?.quantity} [attendu 97.000]`);

  // Bon lifecycle
  const bon = (await call('POST', '/api/bons', {
    fournisseurId: f.id, passagerId: p.id, transportCurrency: 'DZD', transportFee: '5000',
    lines: [
      { designation: 'Cartons A', quantity: '10', weight_kg: '50', cbm: '0.8' },
      { designation: 'Cartons B', quantity: '5', weight_kg: '20', cbm: '0.3' },
    ],
  }, 201)).bon;
  out.push(`Bon créé: ${bon.reference}, statut ${bon.status}, ${bon.lines.length} lignes`);

  await call('POST', `/api/bons/${bon.id}/advance`, {}, 200); // -> en_transit
  const arrived = (await call('POST', `/api/bons/${bon.id}/advance`, {}, 200)).bon; // -> arrive
  out.push(`Après 2 avancements: statut = ${arrived.status} [attendu arrive]`);

  // Reconcile: 1 carton manquant sur la ligne A (perte 800 DZD, responsable passager)
  const reconciled = (await call('POST', `/api/bons/${bon.id}/reconcile`, {
    lines: [
      { lineId: arrived.lines[0].id, receivedQuantity: '9', lossValue: '800', responsible: 'passager' },
      { lineId: arrived.lines[1].id, receivedQuantity: '5', lossValue: '0' },
    ],
  }, 200)).bon;
  out.push(`Réconcilié: perte totale = ${reconciled.loss_total} [attendu 800.00]`);

  const settled = (await call('POST', `/api/bons/${bon.id}/settle`, {}, 200)).bon;
  out.push(`Réglé: statut = ${settled.status}, paiement passager = ${settled.passager_payment} [attendu regle / 4200.00 = 5000-800]`);

  // ── New line model: one measure + reusable articles ───────────────
  const bon2 = (await call('POST', '/api/bons', {
    fournisseurId: f.id, passagerId: p.id, transportCurrency: 'DZD', transportFee: '0',
    lines: [
      { designation: 'Riz Basmati', createItem: true, measure: 'poids', value: '25' },
      { designation: 'Cartons A', createItem: true, measure: 'quantite', value: '3', unit: 'carton' },
    ],
  }, 201)).bon;
  const rizLine = bon2.lines.find((l) => l.designation === 'Riz Basmati');
  out.push(`Ligne poids: measure=${rizLine.measure} poids=${rizLine.weight_kg} qte=${rizLine.quantity} [attendu poids/25.000/0.000]`);

  const rizItem = (await call('GET', '/api/stock/items?search=Riz')).items.find((i) => i.name === 'Riz Basmati');
  out.push(`Article auto-créé et listé: ${rizItem ? rizItem.name : 'INTROUVABLE'} [attendu Riz Basmati]`);

  const bon3 = (await call('POST', '/api/bons', {
    fournisseurId: f.id, transportCurrency: 'DZD', transportFee: '0',
    lines: [{ itemId: rizItem.id, measure: 'poids', value: '10' }],
  }, 201)).bon;
  out.push(`Réutilisation par itemId: designation=${bon3.lines[0].designation} item_id=${bon3.lines[0].item_id} [attendu Riz Basmati / ${rizItem.id}]`);

  // A line whose chosen measure is 0 must be rejected.
  await call('POST', '/api/bons', {
    fournisseurId: f.id, transportCurrency: 'DZD', transportFee: '0',
    lines: [{ designation: 'Vide', measure: 'quantite', value: '0' }],
  }, 400);

  // Guard: settling again must fail (already regle)
  await call('POST', `/api/bons/${bon.id}/settle`, {}, 409);

  await call('GET', '/api/bons?status=regle');

  console.log(out.join('\n'));
  const passed = out.every((l) => !l.startsWith('XX'));
  console.log(passed ? '\nSMOKE-MVP PASSED' : '\nSMOKE-MVP FAILED');
  exitCode = passed ? 0 : 1;
} catch (e) {
  console.error('SMOKE-MVP ERROR:', e);
} finally {
  if (server) server.close();
  try { await closePool(); } catch {}
  try { await embedded?.stop(); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(exitCode);
}
