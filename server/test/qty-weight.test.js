// Chaque ligne porte une quantité ET un poids ; `measure` ne dit que par quoi
// se multiplie le prix.
//
// Ce fichier existe parce que l'ancien modèle ne gardait qu'UNE mesure par
// ligne (pièces, kilos ou m³) et laissait le reste à zéro. Les trois questions
// qui en découlent — que valent un manquant, ce qui part du stock à la
// livraison, ce que le passager peut tirer d'un lot — doivent se lire pareil
// quelle que soit la mesure du prix.
//
// Noms d'articles uniques : `node --test` lance les fichiers en parallèle sur
// la MÊME base, et un niveau de stock est par (article, bureau).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
});
after(async () => { await db.stop(); });

const pool = () => getPool();
const level = async (itemId, office) => (await pool().query(
  'SELECT quantity, weight_kg FROM stock_levels WHERE item_id=$1 AND office=$2', [itemId, office]
)).rows[0] ?? { quantity: '0.000', weight_kg: '0.000' };

async function people() {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. QW ${n}`])).rows[0];
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager QW ${n}`])).rows[0];
  return { n, f, p };
}

// Un lot : 40 cartons, 100 kg, vendu 300 le carton.
async function lot({ f, n }, line = {}) {
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{
    transportCurrency: 'DZD',
    lines: [{ designation: `QW-Lot ${n}`, measure: 'quantite', quantity: '40', weight_kg: '100', unitPrice: '300', ...line }],
  }] } });
  const itemId = (await pool().query('SELECT item_id FROM bon_lines WHERE id=$1', [o.lines[0].line_id])).rows[0].item_id;
  return { o, lineId: o.lines[0].line_id, itemId };
}

test('une ligne sans poids est refusée, une ligne sans quantité aussi', async () => {
  const { f, n } = await people();
  const mk = (l) => orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{
    transportCurrency: 'DZD', lines: [{ designation: `QW-Refus ${n}`, measure: 'quantite', unitPrice: '10', ...l }] }] } });
  await assert.rejects(() => mk({ quantity: '5' }), (e) => /poids/.test(JSON.stringify(e.details)));
  await assert.rejects(() => mk({ weight_kg: '5' }), (e) => /quantité/.test(JSON.stringify(e.details)));
  await assert.rejects(() => mk({ quantity: '5', weight_kg: '0' }), 'un poids nul n’est pas un poids');
});

test('le prix se multiplie par la quantité ou par le poids, selon la mesure', async () => {
  const a = await people();
  const byQty = await lot(a, { measure: 'quantite', unitPrice: '300' });
  assert.equal(byQty.o.bons[0].transport_fee, '12000.00', '40 cartons × 300');

  const b = await people();
  const byKg = await lot(b, { measure: 'poids', unitPrice: '300' });
  assert.equal(byKg.o.bons[0].transport_fee, '30000.00', '100 kg × 300');
  const l = byKg.o.lines[0];
  assert.equal(l.quantity, '40.000', 'la quantité reste celle du suivi, quel que soit le prix');
});

test('un passager tire sur un lot en quantité, le poids suit au prorata, la mesure du prix est libre', async () => {
  const x = await people();
  const { lineId, itemId } = await lot(x);
  assert.deepEqual(await level(itemId, 'china'), { quantity: '40.000', weight_kg: '100.000' });

  // Le lot est vendu à la pièce ; le passager est payé au kilo. Ça n'empêche rien.
  const bon = await bons.createBon({ admin, data: { passagerId: x.p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lineId, measure: 'poids', quantity: '10', unitPrice: '20' }] } });
  const l = (await bons.getBonDetail(bon.id)).lines[0];
  assert.equal(l.quantity, '10.000');
  assert.equal(l.weight_kg, '25.000', '10 cartons sur 40 = 25 kg sur 100');
  assert.equal(l.measure, 'poids');
  assert.equal(bon.transport_fee, '500.00', '25 kg × 20');

  await assert.rejects(
    () => bons.createBon({ admin, data: { passagerId: x.p.id, transportCurrency: 'DZD',
      lines: [{ sourceLineId: lineId, measure: 'quantite', quantity: '31', unitPrice: '20' }] } }),
    (e) => e.code === 'CONFLICT', 'il ne reste que 30 cartons'
  );

  await bons.advanceStatus({ admin, id: bon.id });
  assert.deepEqual(await level(itemId, 'china'), { quantity: '30.000', weight_kg: '75.000' }, 'le départ sort 10 cartons ET 25 kg');
  await bons.advanceStatus({ admin, id: bon.id });
  assert.deepEqual(await level(itemId, 'algeria'), { quantity: '10.000', weight_kg: '25.000' });
});

test('un manquant se compte en cartons et vaut ses cartons, même si le prix est au kilo', async () => {
  const x = await people();
  const { lineId, itemId, o } = await lot(x);
  const bon = await bons.createBon({ admin, data: { passagerId: x.p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lineId, measure: 'poids', quantity: '10', unitPrice: '20' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });
  const l = (await bons.getBonDetail(bon.id)).lines[0];

  // La valeur par défaut du manquant est celle du lot (300 le carton), ramenée au
  // kilo de CE bon : 10 cartons = 25 kg → 120 le kilo. 2 cartons = 5 kg = 600.
  assert.equal(l.missing_unit_price, '120.00');
  const r = await bons.reconcile({ admin, id: bon.id, lines: [{ lineId: l.id, missing: '2' }] });
  assert.equal(r.loss_total, '600.00', '2 cartons × 300 : le manquant ne dépend pas de la mesure du prix');
  assert.equal(r.lines[0].received_quantity, '8.000');

  // Le stock d'Alger perd les 2 cartons et leur poids (5 kg), pas autre chose.
  assert.deepEqual(await level(itemId, 'algeria'), { quantity: '8.000', weight_kg: '20.000' });

  // Et le fournisseur est crédité de 2 cartons à SON prix : 600.
  await bons.setBonStatus({ admin, id: bon.id, target: 'regle' });
  const d = await orders.getOrderDetail(o.id);
  assert.equal(d.lines[0].arrived, '8.000');
  const credit = (await pool().query(
    `SELECT amount FROM person_ledger WHERE person_id = $1 AND note LIKE 'Avoir manquants%'`, [x.f.id]
  )).rows;
  assert.deepEqual(credit.map((r) => r.amount), ['600.00']);
});

test('la livraison se saisit en cartons ; le poids sort du stock au prorata', async () => {
  const x = await people();
  const { lineId, itemId, o } = await lot(x);
  const bon = await bons.createBon({ admin, data: { passagerId: x.p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lineId, measure: 'quantite', quantity: '40', unitPrice: '50' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });
  assert.deepEqual(await level(itemId, 'algeria'), { quantity: '40.000', weight_kg: '100.000' });

  await orders.deliverOrder({ admin, id: o.id, lines: [{ lineId, quantity: '16' }] });
  assert.deepEqual(await level(itemId, 'algeria'), { quantity: '24.000', weight_kg: '60.000' }, '16 cartons = 40 % = 40 kg');

  const d = await orders.getOrderDetail(o.id);
  const seg = (k) => d.progress.segments.find((s) => s.key === k);
  assert.equal(seg('delivered').pct, 40);
  assert.equal(seg('office').pct, 60);

  await orders.cancelDelivery({ admin, id: o.id });
  assert.deepEqual(await level(itemId, 'algeria'), { quantity: '40.000', weight_kg: '100.000' }, 'annuler rend les cartons ET le poids');
});

test('la mesure suggérée pour un article est celle qu’il prend le plus souvent', async () => {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Sugg ${n}`])).rows[0];
  const name = `QW-Sugg ${n}`;
  const make = (measure) => orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: name, measure, quantity: '4', weight_kg: '8', unitPrice: '10' }] }] } });

  await make('poids');
  await make('poids');
  await make('quantite');

  const mine = (await bons.priceHistory({ scope: 'fournisseur' })).any.find((r) => r.designation === name);
  assert.equal(mine.suggested_measure, 'poids', 'deux fois sur trois au poids');

  // Une seule erreur de saisie, la plus récente, ne renverse pas l'habitude.
  await make('poids');
  await make('quantite');
  const after = (await bons.priceHistory({ scope: 'fournisseur' })).any.find((r) => r.designation === name);
  assert.equal(after.suggested_measure, 'poids', 'trois au poids contre deux à la quantité');
});
