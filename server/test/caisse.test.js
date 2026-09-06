import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, balanceOf } from './helpers/testdb.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
import * as transfers from '../src/modules/transfers/transfers.service.js';
import * as rates from '../src/modules/rates/rates.service.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import { getPool } from '../src/db/pool.js';

let db, ctx;

before(async () => {
  db = await setupTestDb(55500);
  ctx = await firstAdminAndCaisse();
});
after(async () => { await db.stop(); });

test('deposit increases balance and writes a ledger row', async () => {
  const r = await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'CNY', amount: '1000', note: 't' });
  assert.equal(r.balance, '1000.00');
  assert.equal(await balanceOf(ctx.caisseId, 'CNY'), '1000.00');
});

test('black-market conversion CNY->DZD is exact and fully recorded', async () => {
  const r = await caisse.convertCurrency({
    admin: ctx.admin, caisseId: ctx.caisseId, fromCurrency: 'CNY', toCurrency: 'DZD', amount: '1000',
  });
  // rate seeded at 30 DZD per CNY
  assert.equal(r.conversion.dzd_value, '30000.00');
  assert.equal(r.conversion.to_amount, '30000.00');
  assert.equal(r.balances.CNY, '0.00');
  assert.equal(r.balances.DZD, '30000.00');

  // two linked ledger legs
  const { rows } = await getPool().query(
    'SELECT direction, currency_code, amount FROM transactions WHERE ref_conversion_id=$1 ORDER BY direction',
    [r.conversion.id]
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => `${x.direction}:${x.currency_code}:${x.amount}`),
    ['in:DZD:30000.00', 'out:CNY:1000.00']);
});

test('withdraw beyond balance is rejected (INSUFFICIENT_FUNDS) and changes nothing', async () => {
  const before = await balanceOf(ctx.caisseId, 'DZD');
  await assert.rejects(
    () => caisse.withdraw({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '999999999' }),
    (e) => e.code === 'INSUFFICIENT_FUNDS'
  );
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), before);
});

test('failed conversion rolls back both balances', async () => {
  const dzdBefore = await balanceOf(ctx.caisseId, 'DZD');
  const usdBefore = (await balanceOf(ctx.caisseId, 'USD')) ?? '0.00';
  await assert.rejects(
    () => caisse.convertCurrency({ admin: ctx.admin, caisseId: ctx.caisseId, fromCurrency: 'USD', toCurrency: 'DZD', amount: '500' }),
    (e) => e.code === 'INSUFFICIENT_FUNDS'
  );
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), dzdBefore); // credit leg rolled back too
  assert.equal((await balanceOf(ctx.caisseId, 'USD')) ?? '0.00', usdBefore);
});

test('same-currency and unknown-currency conversions are rejected', async () => {
  await assert.rejects(
    () => caisse.convertCurrency({ admin: ctx.admin, caisseId: ctx.caisseId, fromCurrency: 'DZD', toCurrency: 'DZD', amount: '1' }),
    (e) => e.code === 'VALIDATION'
  );
  await assert.rejects(
    () => caisse.convertCurrency({ admin: ctx.admin, caisseId: ctx.caisseId, fromCurrency: 'DZD', toCurrency: 'XXX', amount: '1' }),
    (e) => e.code === 'NOT_FOUND'
  );
});

test('concurrent withdrawals cannot overdraw (row lock serializes them)', async () => {
  // fresh currency balance to isolate this test: EUR = 100
  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'EUR', amount: '100' });
  const results = await Promise.allSettled([
    caisse.withdraw({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'EUR', amount: '60' }),
    caisse.withdraw({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'EUR', amount: '60' }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok, 1, 'exactly one withdrawal should succeed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.code, 'INSUFFICIENT_FUNDS');
  assert.equal(await balanceOf(ctx.caisseId, 'EUR'), '40.00');
});

// Sending a transfer must leave BOTH tills exactly as they were: the money is
// still in the origin's drawer until someone at the other end says it arrived.
test('a transfer moves no money until it is confirmed', async () => {
  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '5000' });
  const fromBefore = await balanceOf(ctx.caisseId, 'DZD');
  const toBefore = await balanceOf(ctx.globalCaisseId, 'DZD');

  const t = await transfers.sendTransfer({
    admin: ctx.admin, fromCaisseId: ctx.caisseId, toCaisseId: ctx.globalCaisseId,
    currency: 'DZD', amount: '2000',
  });
  assert.equal(t.status, 'envoye');
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), fromBefore, 'origin must not move on send');
  assert.equal(await balanceOf(ctx.globalCaisseId, 'DZD'), toBefore, 'destination must not move on send');

  await transfers.receiveTransfer({ admin: ctx.admin, id: t.id });
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), (Number(fromBefore) - 2000).toFixed(2));
  assert.equal(await balanceOf(ctx.globalCaisseId, 'DZD'), (Number(toBefore) + 2000).toFixed(2));
});

test('cancelling a pending transfer leaves no trace, and undoing a confirmed one removes both legs', async () => {
  const fromBefore = await balanceOf(ctx.caisseId, 'DZD');
  const toBefore = await balanceOf(ctx.globalCaisseId, 'DZD');

  const pending = await transfers.sendTransfer({
    admin: ctx.admin, fromCaisseId: ctx.caisseId, toCaisseId: ctx.globalCaisseId,
    currency: 'DZD', amount: '500',
  });
  await transfers.deleteTransfer({ admin: ctx.admin, id: pending.id });
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), fromBefore);

  const done = await transfers.sendTransfer({
    admin: ctx.admin, fromCaisseId: ctx.caisseId, toCaisseId: ctx.globalCaisseId,
    currency: 'DZD', amount: '500',
  });
  await transfers.receiveTransfer({ admin: ctx.admin, id: done.id });
  await transfers.unreceiveTransfer({ admin: ctx.admin, id: done.id });
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), fromBefore, 'both legs must be undone');
  assert.equal(await balanceOf(ctx.globalCaisseId, 'DZD'), toBefore);
});

// Nothing reserves the amount while a transfer is pending, so the origin can be
// emptied in between. Confirming then needs a human decision, and forcing it is
// allowed on purpose — the cash did arrive, and the negative balance is the
// honest statement that an entry is missing at the origin.
test('confirming an uncovered transfer needs force, and the caisse stays correctable', async () => {
  const available = Number(await balanceOf(ctx.caisseId, 'DZD'));
  const t = await transfers.sendTransfer({
    admin: ctx.admin, fromCaisseId: ctx.caisseId, toCaisseId: ctx.globalCaisseId,
    currency: 'DZD', amount: String(available),
  });
  await caisse.withdraw({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '1000', note: 'sortie imprévue' });

  await assert.rejects(
    () => transfers.receiveTransfer({ admin: ctx.admin, id: t.id }),
    (e) => e.code === 'INSUFFICIENT_FUNDS'
  );
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), (available - 1000).toFixed(2), 'a refused confirmation changes nothing');

  const forced = await transfers.receiveTransfer({ admin: ctx.admin, id: t.id, force: true });
  assert.equal(forced.forced, true);
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), '-1000.00');

  // The whole point of allowing the negative: the caisse must still accept the
  // corrections that repair it. replayChain() refuses a dip an edit CREATES,
  // never one it merely inherits.
  const { rows } = await getPool().query(
    "SELECT id FROM transactions WHERE caisse_id=$1 AND type='withdrawal' ORDER BY id DESC LIMIT 1", [ctx.caisseId]
  );
  await caisse.updateMovement({ admin: ctx.admin, id: rows[0].id, note: 'corrigée' });
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), '-1000.00');

  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '1000', note: 'dépôt manquant' });
  assert.equal(await balanceOf(ctx.caisseId, 'DZD'), '0.00');
});

// ── Exchange rates: the ALP link, quoted pairs, history ──────────────
// These live here rather than in their own file because `node --test` runs
// files in parallel and setupTestDb() migrates and seeds: two files owning the
// same database race each other on CREATE TABLE.
// The whole point of the period card: a rate that stood for twenty days must
// weigh twenty times one that stood for a day. A plain average of the values
// entered would report a rate no money was ever converted at.
test('the average over a period is weighted by how long each rate stood', async () => {
  await getPool().query("DELETE FROM exchange_rates WHERE currency_code = 'USD'");
  await getPool().query(
    `INSERT INTO exchange_rates (currency_code, dzd_per_unit, created_at) VALUES
       ('USD', 200, '2026-08-01T00:00:00Z'),
       ('USD', 260, '2026-08-21T00:00:00Z')`
  );
  // DZD is the base and sits at 1, so USD->DZD is the USD rate itself.
  const r = await rates.lookup({ from: 'USD', to: 'DZD', start: '2026-08-01', end: '2026-08-21' });

  assert.equal(r.first, '200');
  assert.equal(r.last, '260');
  // 20 days at 200, then the last instant at 260 — the average must sit far
  // nearer 200 than the midpoint 230 a simple average would give.
  assert.ok(Number(r.average) > 200 && Number(r.average) < 203, `moyenne inattendue : ${r.average}`);
});

test('a date before any recorded rate returns nothing, not zero', async () => {
  const r = await rates.lookup({ from: 'USD', to: 'DZD', date: '2020-01-01' });
  assert.equal(r.rate, null);
});

test('a manual pair is what the caisse actually charges', async () => {
  await getPool().query("DELETE FROM exchange_rates WHERE currency_code IN ('USD','CNY')");
  await getPool().query(
    `INSERT INTO exchange_rates (currency_code, dzd_per_unit) VALUES ('USD', 255), ('CNY', 30)`
  );
  await rates.addPair({ admin: ctx.admin, fromCode: 'USD', toCode: 'CNY' });

  // Derived first: 255 / 30 = 8.50, and nothing is quoted yet.
  const [derived] = await rates.listPairs();
  assert.equal(derived.mode, 'derive');
  assert.equal(Number(derived.rate).toFixed(2), '8.50');
  assert.equal(await rates.directRateFor(getPool(), 'USD', 'CNY'), null);

  await rates.setPairRate({ admin: ctx.admin, fromCode: 'USD', toCode: 'CNY', unitsPerUnit: '8.20' });
  const [quoted] = await rates.listPairs();
  assert.equal(quoted.mode, 'manuel');
  assert.equal(Number(quoted.rate).toFixed(2), '8.20');

  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'USD', amount: '100' });
  const before = Number(await balanceOf(ctx.caisseId, 'CNY'));
  const r = await caisse.convertCurrency({
    admin: ctx.admin, caisseId: ctx.caisseId, fromCurrency: 'USD', toCurrency: 'CNY', amount: '100',
  });

  assert.equal(r.conversion.to_amount, '820.00', 'the quoted pair, not the 850.00 the dinar route gives');
  assert.equal(Number(await balanceOf(ctx.caisseId, 'CNY')).toFixed(2), (before + 820).toFixed(2));
  // The row must still add up on its own terms.
  const { dzd_value, to_rate_dzd, to_amount } = r.conversion;
  assert.equal((Number(dzd_value) / Number(to_rate_dzd)).toFixed(2), Number(to_amount).toFixed(2));

  // Directional: the reverse was never quoted, so it keeps routing through DZD.
  assert.equal(await rates.directRateFor(getPool(), 'CNY', 'USD'), null);
});

// The interface hides ALP's pen while the link is on; the API must hold the
// same rule on its own.
test('with the link on, CNY drags ALP along and ALP cannot be set directly', async () => {
  await getPool().query(
    `INSERT INTO app_settings (key, value) VALUES ('taux', '{"alp_suit_cny": true}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );
  await rates.setRate({ admin: ctx.admin, currencyCode: 'CNY', dzdPerUnit: '31.5' });

  const list = await rates.listCurrencies();
  const alp = list.find((c) => c.code === 'ALP');
  assert.equal(Number(alp.dzd_per_unit).toFixed(2), '31.50');
  assert.equal(alp.linked_to, 'CNY');

  await assert.rejects(
    () => rates.setRate({ admin: ctx.admin, currencyCode: 'ALP', dzdPerUnit: '29' }),
    (e) => e.code === 'CONFLICT'
  );

  // Unlinked, ALP goes its own way again.
  await getPool().query("UPDATE app_settings SET value = '{\"alp_suit_cny\": false}' WHERE key = 'taux'");
  await rates.setRate({ admin: ctx.admin, currencyCode: 'ALP', dzdPerUnit: '29' });
  const after = (await rates.listCurrencies()).find((c) => c.code === 'ALP');
  assert.equal(Number(after.dzd_per_unit).toFixed(2), '29.00');
  assert.equal(after.linked_to, null);
});

// ── Une personne, deux rôles · un bon passager, plusieurs fournisseurs ──

// The point of merging the two tables: the same human owing you as a
// fournisseur and being owed as a passager must end on ONE balance, not two
// that someone has to subtract by hand.
test('one person holding both roles nets to a single balance', async () => {
  const { rows } = await getPool().query(
    `INSERT INTO people (name, is_fournisseur, is_passager, passager_type)
     VALUES ('Ali Deux Casquettes', true, true, 'regular') RETURNING id`
  );
  const personId = rows[0].id;
  const pool = getPool();

  // Owes 8 000 as a fournisseur (negative), owed 3 000 as a passager (positive).
  await accounts.appendEntry(pool, {
    personType: 'personne', personId, currency: 'DZD', amount: '-8000.00',
    type: 'transport_fee', adminId: ctx.admin.id, note: 'vente',
  });
  await accounts.appendEntry(pool, {
    personType: 'personne', personId, currency: 'DZD', amount: '3000.00',
    type: 'passager_due', adminId: ctx.admin.id, note: 'transport',
  });

  const account = await accounts.getAccount('personne', personId);
  const dzd = account.balances.filter((b) => b.currency_code === 'DZD');
  assert.equal(dzd.length, 1, 'un seul solde, pas un par rôle');
  assert.equal(dzd[0].balance, '-5000.00', 'il vous doit 8 000 moins les 3 000 dus');
  assert.equal(account.person.is_fournisseur, true);
  assert.equal(account.person.is_passager, true);
});

// The bug: creating a bon fournisseur also writes a `bons` row to hold the
// goods, and that crate was being listed as a bon passager.
test('a bon fournisseur never shows up in the bons passagers list', async () => {
  const f = (await getPool().query(
    `INSERT INTO people (name, is_fournisseur) VALUES ('Fourn. Liste', true) RETURNING *`
  )).rows[0];

  const order = await orders.createOrder({
    admin: ctx.admin,
    data: {
      fournisseurId: f.id,
      bons: [{ transportCurrency: 'DZD', lines: [{ designation: 'Cartons', measure: 'quantite', value: '10', unitPrice: '500' }] }],
    },
  });

  const listed = await bons.listBons({});
  assert.equal(listed.some((b) => b.order_id != null), false, 'aucun bon rattaché à un ordre');
  assert.equal(listed.some((b) => b.reference === order.bons[0].reference), false);

  // …but asking for that order's own bons still finds it.
  const inside = await bons.listBons({ orderId: order.id });
  assert.equal(inside.length, 1);
  assert.equal(inside[0].id, order.bons[0].id);
});

// A passager travels with one suitcase and fills it wherever the goods are
// ready. Each fournisseur must still be credited at their OWN sale price for
// what never arrived.
test('a bon passager carries goods from two fournisseurs and credits each one', async () => {
  const pool = getPool();
  const mk = async (name, cols) => (await pool.query(
    `INSERT INTO people (name, ${cols}) VALUES ($1, true) RETURNING *`, [name]
  )).rows[0];
  const f1 = await mk('Fourn. Un', 'is_fournisseur');
  const f2 = await mk('Fourn. Deux', 'is_fournisseur');
  const p = await mk('Passager Mixte', 'is_passager');

  const o1 = await orders.createOrder({ admin: ctx.admin, data: { fournisseurId: f1.id,
    bons: [{ transportCurrency: 'DZD', lines: [{ designation: 'Écrans', measure: 'quantite', value: '10', unitPrice: '1000' }] }] } });
  const o2 = await orders.createOrder({ admin: ctx.admin, data: { fournisseurId: f2.id,
    bons: [{ transportCurrency: 'DZD', lines: [{ designation: 'Claviers', measure: 'quantite', value: '10', unitPrice: '400' }] }] } });

  const avail = await bons.listAllocatable({});
  const l1 = avail.find((l) => l.designation === 'Écrans');
  const l2 = avail.find((l) => l.designation === 'Claviers');
  assert.ok(l1 && l2, 'les deux lots sont proposés sans filtrer par fournisseur');

  // The line that used to be refused: two sources, two fournisseurs, one bon.
  const bon = await bons.createBon({ admin: ctx.admin, data: {
    passagerId: p.id, transportCurrency: 'DZD',
    lines: [
      { sourceLineId: l1.line_id, measure: 'quantite', value: '10', unitPrice: '600' },
      { sourceLineId: l2.line_id, measure: 'quantite', value: '10', unitPrice: '250' },
    ],
  } });
  assert.equal(bon.fournisseur_id, null, 'un bon passager n’appartient à aucun fournisseur');
  assert.deepEqual(bon.fournisseurs.map((x) => x.name).sort(), ['Fourn. Deux', 'Fourn. Un']);
  assert.equal(bon.transport_fee, '8500.00', '10×600 + 10×250');

  // Two écrans go missing; the claviers all arrive.
  await bons.advanceStatus({ admin: ctx.admin, id: bon.id });
  await bons.advanceStatus({ admin: ctx.admin, id: bon.id });
  const lines = (await bons.getBonDetail(bon.id)).lines;
  await bons.reconcile({ admin: ctx.admin, id: bon.id, lines: lines.map((l) => ({
    lineId: l.id, receivedQuantity: l.designation === 'Écrans' ? '8' : '10',
  })) });
  await bons.settle({ admin: ctx.admin, id: bon.id });

  // f1 is credited 2 × 1000 (their sale price), f2 nothing.
  const a1 = await accounts.getAccount('personne', f1.id);
  const a2 = await accounts.getAccount('personne', f2.id);
  const bal = (a) => a.balances.find((b) => b.currency_code === 'DZD')?.balance;
  assert.equal(bal(a1), '-8000.00', 'facturé 10 000, avoir 2 000 pour les manquants');
  assert.equal(bal(a2), '-4000.00', 'tout est arrivé : aucun avoir');

  // The passager is owed what actually travelled, at cost price.
  const ap = await accounts.getAccount('personne', p.id);
  assert.equal(bal(ap), '7300.00', '8×600 + 10×250');
});
