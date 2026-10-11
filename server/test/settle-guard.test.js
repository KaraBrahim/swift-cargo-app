// Règler plus que la dette : refusé, sauf demande explicite.
//
// Payer 475 000 quand on doit 47 500 retourne la dette dans l'autre sens sans que
// personne l'ait voulu. Le serveur le refuse avec les chiffres ; seul un
// `allowExcess` (une avance, assumée) le laisse passer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, algeriaTestCaisse } from './helpers/testdb.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, caisse;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
  caisse = await algeriaTestCaisse('Caisse Alger (test garde-fou)');
  // De quoi payer : la caisse doit contenir les dinars qu'on sort.
  await getPool().query(
    `INSERT INTO caisse_balances (caisse_id, currency_code, balance) VALUES ($1,'DZD',1000000)
     ON CONFLICT (caisse_id, currency_code) DO UPDATE SET balance = 1000000`, [caisse]);
});
after(async () => { await db.stop(); });

async function passagerDue(name, due) {
  const p = (await getPool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING id', [name])).rows[0];
  await accounts.appendEntry(getPool(), {
    personType: 'personne', personId: p.id, currency: 'DZD', amount: String(due), type: 'adjustment', adminId: admin.id,
  });
  return p.id;
}

const pay = (personId, amount, extra = {}) =>
  accounts.settleAccount({ admin, personId, caisseId: caisse, amount, currency: 'DZD', direction: 'out', ...extra });

test('payer plus que la dette est refusé, avec les chiffres', async () => {
  const id = await passagerDue('Garde-fou A', 47500);
  await assert.rejects(
    () => pay(id, '475000'),
    (e) => e.code === 'AMOUNT_EXCEEDS_DEBT' && e.status === 409
      && e.details.open === '47500.00' && e.details.amount === '475000.00' && e.details.excess === '427500.00'
  );
  const bal = (await getPool().query("SELECT balance FROM person_balances WHERE person_id=$1", [id])).rows[0].balance;
  assert.equal(Number(bal), 47500, 'rien n’a bougé');
});

test('payer exactement la dette, ou moins, passe', async () => {
  const id = await passagerDue('Garde-fou B', 1000);
  await pay(id, '400');
  const r = await pay(id, '600');
  assert.equal(Number(r.balance), 0);
});

test('payer dans le mauvais sens (rien ne nous est dû) est refusé', async () => {
  const id = await passagerDue('Garde-fou C', 500);
  // Il ne doit rien à la maison : l'encaisser n'a pas de sens.
  await assert.rejects(
    () => accounts.settleAccount({ admin, personId: id, caisseId: caisse, amount: '100', currency: 'DZD', direction: 'in' }),
    (e) => e.code === 'AMOUNT_EXCEEDS_DEBT' && e.details.open === '0.00' && e.details.incoming === true
  );
});

test('une avance voulue passe avec allowExcess', async () => {
  const id = await passagerDue('Garde-fou D', 100);
  const r = await pay(id, '150', { allowExcess: true });
  assert.equal(Number(r.balance), -50, 'la dette est retournée : c’est lui qui nous doit 50 maintenant');
});

test('solder garde son propre plafond et n’a pas besoin d’allowExcess', async () => {
  const id = await passagerDue('Garde-fou E', 52340);
  const r = await pay(id, '52000', { settle: true });
  assert.equal(Number(r.balance), 0);
});
