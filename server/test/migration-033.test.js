// La migration 033 reprend les lignes écrites AVANT : une seule mesure par
// ligne, le reste à zéro. Elle ne doit toucher à aucun montant, ni perdre un
// seul chiffre du suivi (confié, arrivé, remis) ni du stock.
//
// Une base à part, migrée jusqu'à 032, qu'on remplit à la main de lignes comme
// l'ancien code les écrivait — c'est le seul moyen de rejouer le passé.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', 'src', 'db', 'migrations');

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const name = `mig033_${process.pid}_${Date.now()}`;
let legacy;

const sqlOf = async (file) => readFile(join(MIGRATIONS, file), 'utf8');

after(async () => {
  await legacy?.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
  await admin.end().catch(() => {});
});

test('033 convertit les lignes au poids et au m³ sans toucher aux montants', async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  legacy = new pg.Client({ connectionString: url.toString() });
  await legacy.connect();

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const upTo032 = files.filter((f) => f < '033');
  for (const f of upTo032) await legacy.query(await sqlOf(f));

  // — Le passé, tel que l'ancien code l'écrivait —
  const q = async (text, params) => (await legacy.query(text, params)).rows;
  await q("INSERT INTO currencies (code, name) VALUES ('DZD','Dinar') ON CONFLICT DO NOTHING");
  const [{ id: adminId }] = await q(
    "INSERT INTO admins (username, full_name, password_hash) VALUES ('u','U','x') RETURNING id");
  const [{ id: fId }] = await q("INSERT INTO people (name, is_fournisseur) VALUES ('F', true) RETURNING id");
  const [{ id: order }] = await q('INSERT INTO orders (fournisseur_id, created_by) VALUES ($1,$2) RETURNING id', [fId, adminId]);
  const [{ id: bon }] = await q(
    `INSERT INTO bons (order_id, fournisseur_id, transport_currency, transport_fee, created_by)
     VALUES ($1,$2,'DZD','1000.00',$3) RETURNING id`, [order, fId, adminId]);
  const [{ id: item }] = await q("INSERT INTO stock_items (name) VALUES ('Sac') RETURNING id");

  const line = async (cols) => (await q(
    `INSERT INTO bon_lines (bon_id, designation, item_id, measure, quantity, unit, weight_kg, cbm, unit_price, missing_unit_price, delivered_quantity, received_quantity)
     VALUES ($1,'L',$2,$3,$4,$5,$6,$7,$8,$8,$9,$10) RETURNING id`,
    [bon, item, cols.measure, cols.quantity ?? 0, cols.unit ?? 'pièce', cols.weight_kg ?? 0, cols.cbm ?? 0, cols.price,
      cols.delivered ?? 0, cols.received ?? null]))[0].id;

  const byQty = await line({ measure: 'quantite', quantity: 10, weight_kg: 4, price: '50' });
  const byKg = await line({ measure: 'poids', weight_kg: 25.5, unit: 'kg', price: '120', delivered: 10, received: 20 });
  const byCbm = await line({ measure: 'cbm', cbm: 1.2, unit: 'm³', price: '3000', delivered: 0.4 });

  await q(`INSERT INTO stock_levels (item_id, office, quantity, weight_kg, cbm) VALUES ($1,'china',0,25.5,0)`, [item]);
  await q(`INSERT INTO stock_movements (item_id, office, quantity_delta, weight_delta, cbm_delta, reason) VALUES ($1,'china',0,25.5,0,'inventaire')`, [item]);
  await q(`INSERT INTO stock_movements (item_id, office, quantity_delta, weight_delta, cbm_delta, reason) VALUES ($1,'china',0,0,1.2,'inventaire')`, [item]);

  // — La migration —
  await legacy.query(await sqlOf('033_qty_and_weight.sql'));

  const get = async (id) => (await q('SELECT * FROM bon_lines WHERE id=$1', [id]))[0];

  const a = await get(byQty);
  assert.deepEqual([a.measure, a.quantity, a.weight_kg, a.unit], ['quantite', '10.000', '4.000', 'pièce'], 'une ligne à la quantité ne bouge pas');

  const b = await get(byKg);
  assert.equal(b.measure, 'poids', 'elle reste tarifée au poids : unit_price × poids ne change pas');
  assert.equal(b.quantity, '25.500', 'sa quantité devient son poids, en kg');
  assert.equal(b.unit, 'kg');
  assert.equal(b.weight_kg, '25.500');
  assert.equal(b.delivered_quantity, '10.000', 'le suivi, déjà en kilos, reste au chiffre près');
  assert.equal(b.received_quantity, '20.000');

  const c = await get(byCbm);
  assert.equal(c.measure, 'quantite', 'le m³ disparaît : la ligne se prend désormais à la quantité');
  assert.equal(c.quantity, '1.200', 'sa quantité devient son volume');
  assert.equal(c.unit, 'm³');
  assert.equal(c.unit_price, '3000.00', 'le prix ne change pas : 3000 × 1.2 comme avant');
  assert.equal(c.delivered_quantity, '0.400');

  // Les montants déjà écrits ne sont jamais recalculés.
  assert.equal((await q('SELECT transport_fee FROM bons WHERE id=$1', [bon]))[0].transport_fee, '1000.00');

  // Le stock : un niveau reste la somme de ses mouvements.
  const lvl = (await q("SELECT quantity, weight_kg FROM stock_levels WHERE item_id=$1 AND office='china'", [item]))[0];
  const mv = (await q("SELECT SUM(quantity_delta) AS q, SUM(weight_delta) AS w FROM stock_movements WHERE item_id=$1", [item]))[0];
  assert.equal(lvl.quantity, '25.500');
  assert.equal(Number(mv.q), 25.5 + 1.2, 'les mouvements au poids et au m³ deviennent des quantités');

  // Le filet de sécurité : l'ancienne valeur est gardée, ligne pour ligne.
  const saved = await q('SELECT id, measure, quantity, weight_kg, cbm FROM archive_033_bon_lines ORDER BY id');
  assert.equal(saved.length, 3);
  const savedCbm = saved.find((r) => r.id === byCbm);
  assert.deepEqual([savedCbm.measure, savedCbm.quantity, savedCbm.cbm], ['cbm', '0.000', '1.2000'], 'la ligne au m³ telle qu’elle était');
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM archive_033_stock_levels'))[0].n, 1);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM archive_033_stock_movements'))[0].n, 2);

  // Et le m³ n'existe plus nulle part (hors ces copies).

  const cols = await q(`SELECT table_name FROM information_schema.columns
                         WHERE table_schema='public' AND column_name IN ('cbm','cbm_delta')
                           AND table_name NOT LIKE 'archive_%'`);
  assert.deepEqual(cols, []);

  // Une mesure 'cbm' ne passe plus.
  await assert.rejects(() => legacy.query("UPDATE bon_lines SET measure='cbm' WHERE id=$1", [byQty]));
});
