// Les six trous d'argent trouvés à l'audit, et le fait qu'ils sont bouchés.
// Chaque test a d'abord été écrit pour ÉCHOUER contre l'ancien code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import { getPool } from '../src/db/pool.js';

let db, ctx, fournisseur, passager;

before(async () => {
  db = await setupTestDb();
  ctx = await firstAdminAndCaisse();
  // `node --test` lance les fichiers en parallèle contre la même base. Ce
  // fichier déposait 5 000 000 DZD dans la caisse partagée, pendant que
  // caisse.test.js y convertissait des yuans et vérifiait le solde obtenu :
  // selon l'ordre d'exécution, l'un des deux échouait. Une caisse à soi, et la
  // course disparaît.
  const own = await getPool().query(
    `INSERT INTO caisses (kind, office, label) VALUES ('office', NULL, 'Caisse intégrité (test)') RETURNING id`
  );
  ctx = { ...ctx, caisseId: own.rows[0].id };
  fournisseur = (await getPool().query(
    "INSERT INTO people (name, is_fournisseur, is_passager) VALUES ('Audit F', TRUE, FALSE) RETURNING id"
  )).rows[0].id;
  passager = (await getPool().query(
    "INSERT INTO people (name, is_fournisseur, is_passager) VALUES ('Audit P', FALSE, TRUE) RETURNING id"
  )).rows[0].id;
  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '5000000' });
});
after(async () => { await db.stop(); });

const personBalance = async (pid, code = 'DZD') => (await getPool().query(
  "SELECT balance FROM person_balances WHERE person_type='personne' AND person_id=$1 AND currency_code=$2",
  [pid, code]
)).rows[0]?.balance ?? '0.00';

const makeOrder = (lines, currency = 'DZD', commission = '0') => orders.createOrder({
  admin: ctx.admin,
  data: { fournisseurId: fournisseur, bons: [{ transportCurrency: currency, commission, lines }] },
});

// ── 1 · Un encaissement ne peut pas dépasser ce qui est dû ──────────────────
test('collectFee refuses a second full collection', async () => {
  const o = await makeOrder([{ designation: 'A', measure: 'quantite', quantity: '10', unitPrice: '100' }]);
  const bonId = o.bons[0].id;
  await bons.collectFee({ admin: ctx.admin, id: bonId, caisseId: ctx.caisseId });
  await assert.rejects(
    () => bons.collectFee({ admin: ctx.admin, id: bonId, caisseId: ctx.caisseId }),
    (e) => e.code === 'CONFLICT' && /déjà encaissés/.test(e.message)
  );
  // Le fournisseur est à zéro : facturé 1000, il a payé 1000. Pas 2000.
  assert.equal(await personBalance(fournisseur), '0.00');
});

test('collectFee refuses more than what is left owing', async () => {
  const o = await makeOrder([{ designation: 'B', measure: 'quantite', quantity: '10', unitPrice: '100' }]);
  await bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId, amount: '400' });
  await assert.rejects(
    () => bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId, amount: '700' }),
    (e) => e.code === 'CONFLICT' && /reste 600\.00/.test(e.message)
  );
  // Le solde restant s'encaisse, lui.
  await bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId });
  await assert.rejects(
    () => bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId, amount: '1' }),
    (e) => e.code === 'CONFLICT'
  );
});

test('two simultaneous collectFee calls collect once', async () => {
  const o = await makeOrder([{ designation: 'C', measure: 'quantite', quantity: '5', unitPrice: '200' }]);
  const before = await personBalance(fournisseur);
  const results = await Promise.allSettled([
    bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId }),
    bons.collectFee({ admin: ctx.admin, id: o.bons[0].id, caisseId: ctx.caisseId }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'one succeeds');
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1, 'the other is refused');
  // Le solde ne remonte que d'UN encaissement de 1000, pas de deux.
  const moved = Number(await personBalance(fournisseur)) - Number(before);
  assert.equal(moved, 1000);
});

test('payPassager is capped at what the bon says it owes', async () => {
  const o = await makeOrder([{ designation: 'D', measure: 'quantite', quantity: '10', unitPrice: '100' }]);
  const srcLine = (await getPool().query('SELECT id FROM bon_lines WHERE bon_id=$1', [o.bons[0].id])).rows[0].id;
  const bp = await bons.createBon({
    admin: ctx.admin,
    data: { passagerId: passager, transportCurrency: 'DZD',
      lines: [{ sourceLineId: srcLine, measure: 'quantite', quantity: '10', unitPrice: '30' }] },
  });
  await bons.setBonStatus({ admin: ctx.admin, id: bp.id, target: 'regle' });
  await bons.payPassager({ admin: ctx.admin, id: bp.id, caisseId: ctx.caisseId });
  await assert.rejects(
    () => bons.payPassager({ admin: ctx.admin, id: bp.id, caisseId: ctx.caisseId }),
    (e) => e.code === 'CONFLICT' && /déjà payé/.test(e.message)
  );
});

// ── 2 · Le solde stocké ne peut plus perdre un mouvement ────────────────────
test('replayChain keeps the projection equal to the sum of movements', async () => {
  const pool = getPool();
  const d1 = await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'USD', amount: '100' });
  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'USD', amount: '50' });

  // Une correction et un dépôt lancés ensemble : le verrou pris par replayChain
  // les sérialise, au lieu de laisser la correction écraser le dépôt.
  await Promise.all([
    caisse.updateMovement({ admin: ctx.admin, id: d1.transactionId, amount: '120' }),
    caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'USD', amount: '25' }),
  ]);

  const stored = (await pool.query(
    "SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code='USD'", [ctx.caisseId])).rows[0].balance;
  const truth = (await pool.query(
    `SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)::text AS s
       FROM transactions WHERE caisse_id=$1 AND currency_code='USD'`, [ctx.caisseId])).rows[0].s;
  assert.equal(stored, Number(truth).toFixed(2));
  assert.equal(stored, '195.00');
});

// ── 3 · Deux devises ne s'additionnent pas ──────────────────────────────────
test('a passager line drawn from a lot priced in another currency is refused', async () => {
  const o = await makeOrder([{ designation: 'E', measure: 'quantite', quantity: '10', unitPrice: '500' }], 'CNY');
  const srcLine = (await getPool().query('SELECT id FROM bon_lines WHERE bon_id=$1', [o.bons[0].id])).rows[0].id;
  await assert.rejects(
    () => bons.createBon({
      admin: ctx.admin,
      data: { passagerId: passager, transportCurrency: 'DZD',
        lines: [{ sourceLineId: srcLine, measure: 'quantite', quantity: '10', unitPrice: '100' }] },
    }),
    (e) => e.code === 'VALIDATION'
  );
  // Avec une valeur du manquant saisie dans la devise du bon, c'est accepté.
  const ok = await bons.createBon({
    admin: ctx.admin,
    data: { passagerId: passager, transportCurrency: 'DZD',
      lines: [{ sourceLineId: srcLine, measure: 'quantite', quantity: '10', unitPrice: '100', missingUnitPrice: '2500' }] },
  });
  assert.equal(ok.lines[0].missing_unit_price, '2500.00');
});

// ── 4 · L'en-tête d'un bon est d'accord avec ses lignes ─────────────────────
test('a partial reconcile leaves loss_total equal to the sum of the lines', async () => {
  const o = await makeOrder([
    { designation: 'F1', measure: 'quantite', quantity: '10', unitPrice: '100' },
    { designation: 'F2', measure: 'quantite', quantity: '10', unitPrice: '100' },
  ]);
  const src = (await getPool().query('SELECT id FROM bon_lines WHERE bon_id=$1 ORDER BY id', [o.bons[0].id])).rows;
  const bp = await bons.createBon({
    admin: ctx.admin,
    data: { passagerId: passager, transportCurrency: 'DZD',
      lines: src.map((x) => ({ sourceLineId: x.id, measure: 'quantite', quantity: '10', unitPrice: '50' })) },
  });
  await bons.setBonStatus({ admin: ctx.admin, id: bp.id, target: 'arrive' });
  const pl = (await getPool().query('SELECT id FROM bon_lines WHERE bon_id=$1 ORDER BY id', [bp.id])).rows;

  await bons.reconcile({ admin: ctx.admin, id: bp.id, lines: pl.map((l) => ({ lineId: l.id, missing: '1' })) });
  // Une correction ne nommant qu'une ligne : l'autre garde son manquant, et le
  // total de l'en-tête doit les compter toutes les deux.
  await bons.reconcile({ admin: ctx.admin, id: bp.id, lines: [{ lineId: pl[0].id, missing: '3' }] });

  const head = (await getPool().query('SELECT loss_total FROM bons WHERE id=$1', [bp.id])).rows[0].loss_total;
  const sum = (await getPool().query('SELECT SUM(loss_value)::text AS s FROM bon_lines WHERE bon_id=$1', [bp.id])).rows[0].s;
  assert.equal(head, Number(sum).toFixed(2));
  assert.equal(head, '400.00');   // 3 manquants + 1 manquant, à 100
});

// ── 5 · Une suppression se réplique ─────────────────────────────────────────
test('deleting a movement emits a delete event for the other office', async () => {
  const d = await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'EUR', amount: '77' });
  const uuid = (await getPool().query('SELECT uuid FROM transactions WHERE id=$1', [d.transactionId])).rows[0].uuid;
  await caisse.deleteMovement({ admin: ctx.admin, id: d.transactionId });
  const { rows } = await getPool().query(
    "SELECT op FROM sync_outbox WHERE entity='transactions' AND entity_uuid=$1 AND op='delete'", [uuid]
  );
  assert.equal(rows.length, 1, 'the deletion is in the feed');
});

test('a charge replicates, like the movement it causes', async () => {
  const { rows } = await getPool().query(
    "SELECT COUNT(*)::int n FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid WHERE c.relname='charges' AND NOT g.tgisinternal"
  );
  assert.ok(rows[0].n >= 3, 'origin + capture + capture_del');
});

// ── 6 · Un ordre bouge d'un seul tenant ─────────────────────────────────────
test('deleting an order rolls back entirely when a child refuses', async () => {
  const o = await makeOrder([{ designation: 'G', measure: 'quantite', quantity: '10', unitPrice: '100' }]);
  const srcLine = (await getPool().query('SELECT id FROM bon_lines WHERE bon_id=$1', [o.bons[0].id])).rows[0].id;
  // Un passager transporte la marchandise : le bon fournisseur ne peut plus partir.
  await bons.createBon({
    admin: ctx.admin,
    data: { passagerId: passager, transportCurrency: 'DZD',
      lines: [{ sourceLineId: srcLine, measure: 'quantite', quantity: '4', unitPrice: '20' }] },
  });
  const owedBefore = await personBalance(fournisseur);

  await assert.rejects(() => orders.deleteOrder({ admin: ctx.admin, id: o.id }), (e) => e.code === 'CONFLICT');

  // Rien n'a bougé : ni l'ordre, ni ses bons, ni le compte du fournisseur.
  const still = await getPool().query('SELECT COUNT(*)::int n FROM bons WHERE order_id=$1', [o.id]);
  assert.equal(still.rows[0].n, 1);
  assert.equal((await getPool().query('SELECT COUNT(*)::int n FROM orders WHERE id=$1', [o.id])).rows[0].n, 1);
  assert.equal(await personBalance(fournisseur), owedBefore);
});

// ── 7 · La même clé ne rejoue pas l'opération ───────────────────────────────
test('an idempotency key stores its response and is refused for another body', async () => {
  const pool = getPool();
  await pool.query(
    `INSERT INTO idempotency_keys (key, admin_id, method, path, fingerprint, status, response)
     VALUES ('audit-key-0001', $1, 'POST', '/caisses/1/deposit', 'abc', 201, '{"balance":"10.00"}')`,
    [ctx.admin.id]
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO idempotency_keys (key, admin_id, method, path, fingerprint)
       VALUES ('audit-key-0001', $1, 'POST', '/caisses/1/deposit', 'def')`, [ctx.admin.id]),
    (e) => e.code === '23505'
  );
  const { rows } = await pool.query("SELECT response FROM idempotency_keys WHERE key='audit-key-0001'");
  assert.equal(rows[0].response.balance, '10.00');
});

// ── 8 · L'échelle promise est celle que les colonnes tiennent ───────────────
test('a currency cannot claim a scale the money columns cannot hold', async () => {
  await assert.rejects(
    () => getPool().query(
      "INSERT INTO currencies (code, name, symbol, minor_units, sort_order) VALUES ('JPY','Yen','¥',0,99)"),
    (e) => e.code === '23514'
  );
});

// ── 9 · Le bureau d'en face applique bien la suppression ────────────────────
// Le smoke sync monte trois grappes Postgres ; ce test rejoue le même geste sur
// une seule : l'événement de suppression est appliqué comme un distant, et le
// solde projeté est reconstruit sans le mouvement disparu.
test('a delete event applied from the other office removes the row and fixes the balance', async () => {
  const pool = getPool();
  const { applyEvents, recomputeProjections } = await import('../src/modules/sync/sync.service.js');

  const d = await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'CNY', amount: '900' });
  const row = (await pool.query('SELECT * FROM transactions WHERE id=$1', [d.transactionId])).rows[0];
  const balBefore = (await pool.query(
    "SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code='CNY'", [ctx.caisseId])).rows[0].balance;

  // Tel qu'il arriverait du hub.
  const { withTx } = await import('../src/db/pool.js');
  await withTx((c) => applyEvents(c, [{
    uuid: '00000000-0000-4000-8000-00000000dead',
    entity: 'transactions', entity_uuid: row.uuid, op: 'delete',
    snapshot: row, origin_site: 'china', server_seq: 999999,
  }]));

  const gone = await pool.query('SELECT 1 FROM transactions WHERE id=$1', [d.transactionId]);
  assert.equal(gone.rows.length, 0, 'la ligne a disparu ici aussi');

  await withTx((c) => recomputeProjections(c));
  const balAfter = (await pool.query(
    "SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code='CNY'", [ctx.caisseId])).rows[0].balance;
  assert.equal(Number(balBefore) - Number(balAfter), 900, 'le solde a suivi');
});
