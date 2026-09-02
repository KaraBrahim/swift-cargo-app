import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, balanceOf } from './helpers/testdb.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
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

test('transfer moves funds between caisses atomically', async () => {
  await caisse.deposit({ admin: ctx.admin, caisseId: ctx.caisseId, currency: 'DZD', amount: '5000' });
  const dzdBefore = await balanceOf(ctx.caisseId, 'DZD');
  const r = await caisse.transfer({
    admin: ctx.admin, fromCaisseId: ctx.caisseId, toCaisseId: ctx.globalCaisseId, currency: 'DZD', amount: '2000',
  });
  assert.equal(r.balances[ctx.caisseId], (Number(dzdBefore) - 2000).toFixed(2));
  assert.equal(await balanceOf(ctx.globalCaisseId, 'DZD'), '2000.00');
});
