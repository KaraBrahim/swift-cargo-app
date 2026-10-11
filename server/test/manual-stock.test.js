// Le stock entré à la main (« Entrer du stock ») est proposé à un passager, comme un lot.
//
// Ce que ces tests tiennent :
//   · seul le stock LIBRE est proposé — pas ce que des lots de bons fournisseurs ou
//     d'autres bons passagers « créés » occupent déjà ;
//   · un bon ne peut pas emporter plus que le libre, deux lignes du même article
//     s'additionnent, et corriger un bon ne se compte pas deux fois ;
//   · le départ débite la Chine et l'arrivée crédite l'Algérie, comme pour un lot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as stock from '../src/modules/stock/stock.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, passagerId;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
  passagerId = (await getPool().query("INSERT INTO people (name, is_passager) VALUES ('Passager Stock Libre', true) RETURNING id")).rows[0].id;
});
after(async () => { await db.stop(); });

const newItem = async (qty, kg) => {
  const it = await stock.createItem({ admin, data: { name: `Article libre ${++seq}` } });
  await stock.setLevel({ admin, itemId: it.id, office: 'china', quantity: qty, weight_kg: kg });
  return it;
};
const free = async (itemId, forBonId) =>
  (await bons.listManualStock({ forBonId })).find((r) => r.item_id === itemId);
const level = async (itemId, office) => Number((await getPool().query(
  'SELECT quantity FROM stock_levels WHERE item_id=$1 AND office=$2', [itemId, office])).rows[0]?.quantity ?? 0);

const takeBon = (itemId, quantity, weight = '1') => bons.createBon({ admin, data: {
  passagerId, transportCurrency: 'DZD',
  lines: [{ itemId, measure: 'quantite', quantity: String(quantity), weight_kg: weight, unitPrice: '100', missingUnitPrice: '500' }],
} });

test('le stock entré à la main est proposé, avec sa quantité et son poids', async () => {
  const it = await newItem('5', '7');
  const row = await free(it.id);
  assert.ok(row, 'l’article est proposé');
  assert.equal(row.quantity, '5.000');
  assert.equal(row.weight_kg, '7.000');
  assert.equal(row.manual, true);
  assert.equal(row.fournisseur_id, null, 'il n’a pas de fournisseur');
  // La liste du sélecteur le contient avec les lots.
  assert.ok((await bons.listPickable({})).some((r) => r.line_id === `item-${it.id}`));
  // Filtrer par fournisseur écarte le stock libre : il n'est à personne.
  assert.ok(!(await bons.listPickable({ fournisseurId: 999999 })).some((r) => r.manual));
});

test('un article à zéro n’est pas proposé', async () => {
  const it = await newItem('0', '0');
  assert.equal(await free(it.id), undefined);
});

test('un bon réserve : le libre baisse, et on ne peut pas prendre plus que le libre', async () => {
  const it = await newItem('5', '7');
  const bon = await takeBon(it.id, 3, '4');
  assert.equal(bon.lines[0].item_id, it.id);
  assert.equal(bon.lines[0].source_line_id, null, 'aucun lot derrière');
  assert.equal((await free(it.id)).quantity, '2.000', '5 − 3 réservés');

  await assert.rejects(() => takeBon(it.id, 3), (e) => e.code === 'CONFLICT' && /Stock libre insuffisant/.test(e.message));
  await takeBon(it.id, 2, '3');
  assert.equal(await free(it.id), undefined, 'plus rien de libre');
});

test('deux lignes du même article dans un bon s’additionnent', async () => {
  const it = await newItem('4', '4');
  await assert.rejects(() => bons.createBon({ admin, data: { passagerId, transportCurrency: 'DZD', lines: [
    { itemId: it.id, quantity: '3', weight_kg: '3', unitPrice: '10', missingUnitPrice: '1' },
    { itemId: it.id, quantity: '3', weight_kg: '3', unitPrice: '10', missingUnitPrice: '1' },
  ] } }), (e) => e.code === 'CONFLICT');
});

test('corriger un bon ne compte pas sa propre réservation deux fois', async () => {
  const it = await newItem('5', '5');
  const bon = await takeBon(it.id, 5, '5');
  assert.equal(await free(it.id), undefined);
  // Le bon se voit lui-même ses 5 pièces (forBonId), et peut en reprendre 4.
  assert.equal((await free(it.id, bon.id)).quantity, '5.000');
  const edited = await bons.updateBon({ admin, id: bon.id, data: { lines: [
    { itemId: it.id, quantity: '4', weight_kg: '4', unitPrice: '100', missingUnitPrice: '500' },
  ] } });
  assert.equal(edited.lines[0].quantity, '4.000');
  assert.equal((await free(it.id)).quantity, '1.000');
});

test('le départ débite la Chine, l’arrivée crédite l’Algérie, et le libre suit', async () => {
  const it = await newItem('6', '6');
  const bon = await takeBon(it.id, 4, '4');
  await bons.advanceStatus({ admin, id: bon.id }); // en route
  assert.equal(await level(it.id, 'china'), 2);
  assert.equal((await free(it.id)).quantity, '2.000', 'ce qui est parti n’est plus libre, le reste l’est');
  await bons.advanceStatus({ admin, id: bon.id }); // arrivé
  assert.equal(await level(it.id, 'algeria'), 4);
});

test('le stock libre n’avale pas les lots : un lot de 10 + 4 entrés à la main → 4 libres', async () => {
  const f = (await getPool().query("INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING id", [`Fourn. Stock ${++seq}`])).rows[0];
  const it = await stock.createItem({ admin, data: { name: `Article lot ${++seq}` } });
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD', lines: [
    { itemId: it.id, designation: it.name, measure: 'quantite', quantity: '10', weight_kg: '10', unitPrice: '100' },
  ] }] } });
  assert.equal(await free(it.id), undefined, 'un lot reçu n’est pas du stock libre');
  const lotQty = await level(it.id, 'china');
  await stock.setLevel({ admin, itemId: it.id, office: 'china', quantity: String(lotQty + 4), weight_kg: '14' });
  assert.equal((await free(it.id)).quantity, '4.000');

  // Un passager prend 6 du lot : le libre ne bouge pas, avant comme après le départ.
  const lot = (await bons.listAllocatable({ orderId: o.id }))[0];
  const bon = await bons.createBon({ admin, data: { passagerId, transportCurrency: 'DZD',
    lines: [{ sourceLineId: lot.line_id, measure: 'quantite', quantity: '6', unitPrice: '50', missingUnitPrice: '100' }] } });
  assert.equal((await free(it.id)).quantity, '4.000');
  await bons.advanceStatus({ admin, id: bon.id });
  assert.equal((await free(it.id)).quantity, '4.000', 'le départ du lot n’entame pas le libre');
});
