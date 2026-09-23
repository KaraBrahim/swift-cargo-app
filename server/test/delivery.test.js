// La cinquième étape : la marchandise sort du bureau d'Alger.
//
// Ce fichier existe pour un trou précis. `applyMovement` connaissait
// « reception » (Chine +), « depart » (Chine −) et « arrivee » (Algérie +).
// Rien n'en sortait jamais : le stock algérien ne pouvait que grossir, et il
// comptait encore la marchandise remise au client il y a six mois.
//
// `node --test` lance chaque fichier en parallèle contre la MÊME base. Ce
// fichier a donc sa propre caisse et ses propres articles, nommés de façon
// unique : les niveaux de stock sont par (article, bureau), et un article
// partagé avec un autre fichier ferait échouer l'un ou l'autre au hasard de
// l'ordonnancement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, balanceOf } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
import * as people from '../src/modules/people/people.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, caisseId;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  const ctx = await firstAdminAndCaisse();
  admin = ctx.admin;
  // `office` à NULL, et pas 'algeria' : un index unique partiel
  // (uniq_office_caisse) n'autorise qu'une seule caisse par bureau. C'est la
  // façon dont reports.test.js et money-integrity.test.js se donnent déjà une
  // caisse à eux sur une base partagée par des processus de test parallèles.
  const { rows } = await getPool().query(
    "INSERT INTO caisses (kind, office, label) VALUES ('office', NULL, 'Caisse livraison (test)') RETURNING id"
  );
  caisseId = rows[0].id;
});
after(async () => { await db.stop(); });

const pool = () => getPool();
const statusOf = async (id) => (await pool().query('SELECT status FROM orders WHERE id=$1', [id])).rows[0].status;
const levelOf = async (itemId, office) => (await pool().query(
  'SELECT quantity FROM stock_levels WHERE item_id=$1 AND office=$2', [itemId, office]
)).rows[0]?.quantity ?? '0.000';
const itemOf = async (lineId) => (await pool().query('SELECT item_id FROM bon_lines WHERE id=$1', [lineId])).rows[0].item_id;

// Un décor complet : un fournisseur, un ordre de 40 cartons, un passager qui
// les emporte tous, et le voyage jusqu'à Alger. `missing` simule ce qui n'est
// jamais arrivé.
async function shipment({ qty = '40', take = '40', missing = null, f: reuseF, p: reuseP } = {}) {
  const n = ++seq;
  const f = reuseF ?? (await pool().query(
    'INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Livraison ${n}`]
  )).rows[0];
  const p = reuseP ?? (await pool().query(
    'INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager Livraison ${n}`]
  )).rows[0];

  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{
    transportCurrency: 'DZD',
    lines: [{ designation: `Livr-Test ${n}`, measure: 'quantite', value: qty, unitPrice: '300' }],
  }] } });
  const srcLine = o.lines[0];
  const itemId = await itemOf(srcLine.line_id);

  const bon = await bons.createBon({ admin, data: {
    passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: srcLine.line_id, measure: 'quantite', value: take, unitPrice: '50' }],
  } });
  await bons.advanceStatus({ admin, id: bon.id });           // départ de Chine
  await bons.advanceStatus({ admin, id: bon.id });           // arrivée à Alger
  if (missing) {
    const l = (await bons.getBonDetail(bon.id)).lines[0];
    await bons.reconcile({ admin, id: bon.id, lines: [{ lineId: l.id, missing }] });
  }
  return { f, p, order: o, bonId: bon.id, orderBonId: o.bons[0].id, lineId: srcLine.line_id, itemId };
}

// Une seconde expédition du MÊME fournisseur, portée par le même passager.
const shipmentFor = (f, p) => shipment({ f, p });

test('la marchandise entre en Algérie à l’arrivée et en ressort à la livraison', async () => {
  const s = await shipment();

  assert.equal(await levelOf(s.itemId, 'china'), '0.000', 'la Chine s’est vidée au départ');
  assert.equal(await levelOf(s.itemId, 'algeria'), '40.000', 'Alger a reçu les 40 cartons');
  assert.equal(await statusOf(s.order.id), 'arrivee');

  const d = await orders.getOrderDetail(s.order.id);
  assert.equal(d.lines[0].arrived, '40.000');
  assert.equal(d.lines[0].deliverable, '40.000');

  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '40' }] });

  assert.equal(await levelOf(s.itemId, 'algeria'), '0.000', 'le fournisseur les a emportées');
  assert.equal(await statusOf(s.order.id), 'livree');

  // Les quatre jambes du voyage, dans l'ordre.
  const { rows } = await pool().query(
    'SELECT office, reason, quantity_delta FROM stock_movements WHERE item_id=$1 ORDER BY id', [s.itemId]
  );
  assert.deepEqual(rows.map((r) => `${r.office}:${r.reason}:${r.quantity_delta}`), [
    'china:reception:40.000',
    'china:depart:-40.000',
    'algeria:arrivee:40.000',
    'algeria:livraison:-40.000',
  ]);
});

test('une livraison partielle laisse l’ordre à « arrivée » et le reste au bureau', async () => {
  const s = await shipment();

  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '15' }] });
  assert.equal(await statusOf(s.order.id), 'arrivee', 'il reste 25 cartons au bureau');
  assert.equal(await levelOf(s.itemId, 'algeria'), '25.000');

  let d = await orders.getOrderDetail(s.order.id);
  assert.equal(d.lines[0].delivered_quantity, '15.000');
  assert.equal(d.lines[0].deliverable, '25.000');

  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '25' }] });
  assert.equal(await statusOf(s.order.id), 'livree');
  d = await orders.getOrderDetail(s.order.id);
  assert.equal(d.lines[0].deliverable, '0.000');
});

test('on ne livre que ce qui est arrivé : un manquant n’est jamais livrable', async () => {
  const s = await shipment({ missing: '6' });

  const d = await orders.getOrderDetail(s.order.id);
  assert.equal(d.lines[0].arrived, '34.000', '40 commandés, 6 jamais arrivés');
  assert.equal(d.lines[0].deliverable, '34.000');

  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '34' }] });
  assert.equal(await statusOf(s.order.id), 'livree',
    'les 6 manquants sont un avoir sur le compte, pas une livraison en attente');
  assert.equal(await levelOf(s.itemId, 'algeria'), '0.000');
});

test('livrer plus que ce qui est au bureau est refusé, et ne bouge rien', async () => {
  const s = await shipment();

  await assert.rejects(
    () => orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '41' }] }),
    (e) => e.code === 'CONFLICT' && /41/.test(e.message) && /Livr-Test/.test(e.message)
  );
  assert.equal(await levelOf(s.itemId, 'algeria'), '40.000', 'le stock est intact');
  assert.equal(await statusOf(s.order.id), 'arrivee');
});

// « Régler et verser » au comptoir : on règle le bon et on donne ce qu'on a en
// caisse, pas forcément tout. Le reste se paie plus tard depuis « Argent ».
test("le règlement peut ne verser qu'une partie du dû au passager", async () => {
  const s = await shipment();
  const { rows: [bon] } = await getPool().query('SELECT transport_fee FROM bons WHERE id=$1', [s.bonId]);
  const due = Number(bon.transport_fee);

  // De quoi payer : la caisse de ce fichier ne sert qu'à lui.
  await caisse.deposit({ admin, caisseId, currency: 'DZD', amount: String(due + 1000), note: 'test' });
  const before = Number(await balanceOf(caisseId, 'DZD'));
  await bons.settle({ admin, id: s.bonId, caisseId, paidNow: '1000' });

  assert.equal(Number(await balanceOf(caisseId, 'DZD')), before - 1000, "la caisse ne sort que ce qu'on a versé");
  const { rows: [paid] } = await getPool().query(
    "SELECT COALESCE(SUM(ABS(amount)), 0) AS t FROM person_ledger WHERE ref_bon_id=$1 AND type='passager_payment'", [s.bonId]
  );
  assert.equal(Number(paid.t), 1000);

  // Le reste reste payable, et pas un dinar de plus.
  await bons.payPassager({ admin, id: s.bonId, caisseId });
  const { rows: [after] } = await getPool().query(
    "SELECT COALESCE(SUM(ABS(amount)), 0) AS t FROM person_ledger WHERE ref_bon_id=$1 AND type='passager_payment'", [s.bonId]
  );
  assert.equal(Number(after.t), due, 'le total versé est exactement le dû');
  await assert.rejects(bons.payPassager({ admin, id: s.bonId, caisseId }), /déjà payé/);
});

test('la clôture demande la livraison, le règlement des passagers ET les frais encaissés', async () => {
  const s = await shipment();

  await bons.settle({ admin, id: s.bonId });
  assert.equal(await statusOf(s.order.id), 'arrivee', 'réglé mais pas encore livré');

  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '40' }] });
  assert.equal(await statusOf(s.order.id), 'livree', 'livré, mais les frais ne sont pas payés');

  // 40 × 300 = 12 000 dus par le fournisseur, encaissés en deux fois.
  await bons.collectFee({ admin, id: s.orderBonId, caisseId, amount: '5000' });
  assert.equal(await statusOf(s.order.id), 'livree', 'un acompte ne clôture pas');

  await bons.collectFee({ admin, id: s.orderBonId, caisseId });
  assert.equal(await statusOf(s.order.id), 'cloturee');

  const closed = await pool().query('SELECT delivered_at, closed_at FROM orders WHERE id=$1', [s.order.id]);
  assert.ok(closed.rows[0].delivered_at, 'la date de remise est posée');
  assert.ok(closed.rows[0].closed_at, 'la date de clôture aussi');
});

test('un règlement au comptoir clôture aussi, alors qu’il ne porte le numéro d’aucun ordre', async () => {
  const s = await shipment();
  await bons.settle({ admin, id: s.bonId });
  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '40' }] });
  assert.equal(await statusOf(s.order.id), 'livree');

  // settleAccount n'écrit aucun ref_order_id : sans le second bras de la règle
  // « payé », cet ordre resterait « livrée » pour toujours alors que le
  // fournisseur ne doit plus rien.
  await accounts.settleAccount({
    admin, personId: s.f.id, caisseId, amount: '12000', currency: 'DZD', direction: 'in',
  });
  assert.equal(await statusOf(s.order.id), 'cloturee');
});

test('annuler la livraison rend la marchandise au stock d’Alger', async () => {
  const s = await shipment();
  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '40' }] });
  assert.equal(await levelOf(s.itemId, 'algeria'), '0.000');

  await orders.cancelDelivery({ admin, id: s.order.id });
  assert.equal(await levelOf(s.itemId, 'algeria'), '40.000', 'exactement le niveau d’avant');
  assert.equal(await statusOf(s.order.id), 'arrivee');

  const d = await orders.getOrderDetail(s.order.id);
  assert.equal(d.lines[0].delivered_quantity, '0.000');
  assert.equal(d.lines[0].deliverable, '40.000');
  assert.equal((await pool().query('SELECT delivered_at FROM orders WHERE id=$1', [s.order.id])).rows[0].delivered_at, null);
});

test('reprendre un encaissement rouvre un ordre clôturé', async () => {
  const s = await shipment();
  await bons.settle({ admin, id: s.bonId });
  await orders.deliverOrder({ admin, id: s.order.id, lines: [{ lineId: s.lineId, quantity: '40' }] });
  await bons.collectFee({ admin, id: s.orderBonId, caisseId });
  assert.equal(await statusOf(s.order.id), 'cloturee');

  const pay = (await pool().query(
    "SELECT id FROM person_ledger WHERE ref_order_id=$1 AND type='fee_payment' ORDER BY id DESC LIMIT 1", [s.order.id]
  )).rows[0];
  await accounts.deletePayment({ admin, entryId: pay.id });
  assert.equal(await statusOf(s.order.id), 'livree', 'la dette est rouverte, donc l’ordre aussi');
});

// ── Le comptoir : la remise à une personne, tous ordres confondus ─────
test('la remise au comptoir vide plusieurs ordres du même homme en une fois', async () => {
  const a = await shipment();
  // Deux autres expéditions du MÊME fournisseur : c'est le cas que la fiche
  // d'un ordre ne sait pas montrer.
  const b = await shipmentFor(a.f, a.p);
  const c = await shipmentFor(a.f, a.p);

  const waiting = await people.deliverableFor(a.f.id);
  assert.equal(waiting.orders.length, 3, 'trois ordres l’attendent');
  assert.equal(waiting.total, 3);

  const lines = waiting.orders.flatMap((o) => o.lines.map((l) => ({ lineId: l.id, quantity: l.deliverable })));
  const after = await people.deliverToPerson({ admin, personId: a.f.id, lines });

  assert.equal(after.total, 0, 'plus rien ne l’attend');
  for (const s of [a, b, c]) {
    assert.equal(await statusOf(s.order.id), 'livree');
    assert.equal(await levelOf(s.itemId, 'algeria'), '0.000');
  }
});

test('la marchandise d’un autre fournisseur est refusée au comptoir', async () => {
  const mine = await shipment();
  const other = await shipment();

  await assert.rejects(
    () => people.deliverToPerson({
      admin, personId: mine.f.id,
      lines: [{ lineId: other.lineId, quantity: '1' }],
    }),
    (e) => e.code === 'VALIDATION'
  );
  assert.equal(await levelOf(other.itemId, 'algeria'), '40.000', 'rien n’a bougé chez l’autre');
});

test('une remise à cheval sur plusieurs ordres est tout ou rien', async () => {
  const a = await shipment();
  const b = await shipmentFor(a.f, a.p);

  // La seconde ligne demande plus que ce qui est au bureau : la première ne
  // doit pas être sortie du stock pour autant.
  await assert.rejects(
    () => people.deliverToPerson({
      admin, personId: a.f.id,
      lines: [
        { lineId: a.lineId, quantity: '40' },
        { lineId: b.lineId, quantity: '41' },
      ],
    }),
    (e) => e.code === 'CONFLICT'
  );
  assert.equal(await levelOf(a.itemId, 'algeria'), '40.000', 'la première ligne est intacte');
  assert.equal(await levelOf(b.itemId, 'algeria'), '40.000');
  assert.equal(await statusOf(a.order.id), 'arrivee');
});

test('une marchandise encore en vol n’est pas livrable', async () => {
  const n = ++seq;
  const f = (await pool().query(
    'INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Vol ${n}`]
  )).rows[0];
  const p = (await pool().query(
    'INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager Vol ${n}`]
  )).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{
    transportCurrency: 'DZD',
    lines: [{ designation: `Livr-Vol ${n}`, measure: 'quantite', value: '20', unitPrice: '300' }],
  }] } });
  const bon = await bons.createBon({ admin, data: {
    passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: o.lines[0].line_id, measure: 'quantite', value: '20', unitPrice: '50' }],
  } });
  await bons.advanceStatus({ admin, id: bon.id }); // en transit, pas encore arrivé

  const d = await orders.getOrderDetail(o.id);
  assert.equal(d.lines[0].arrived, '0.000', 'rien n’est au bureau tant que le porteur vole');
  assert.equal(d.lines[0].deliverable, '0.000');
  assert.equal(await statusOf(o.id), 'en_transit');
  await assert.rejects(
    () => orders.deliverOrder({ admin, id: o.id, lines: [{ lineId: o.lines[0].line_id, quantity: '1' }] }),
    (e) => e.code === 'CONFLICT'
  );
});
