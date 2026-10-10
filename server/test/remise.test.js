// La remise de règlement : solder une dette à un montant rond.
//
// Ce que ces tests tiennent, et qui est la raison d'être de la fonction :
//   · la CAISSE ne bouge que du montant RÉELLEMENT versé ;
//   · le compte de la personne tombe à ZÉRO — la dette est soldée « selon
//     l'accord » — et la remise est une écriture à elle, tracée ;
//   · l'argent d'une caisse reste égal à la somme de ses mouvements ;
//   · annuler le paiement emporte la remise, et un paiement avec remise ne se
//     corrige pas à la main.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, algeriaTestCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
import * as employees from '../src/modules/employees/employees.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, alger, payer;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
  alger = await algeriaTestCaisse('Caisse Alger (test remise)');
  payer = await algeriaTestCaisse('Caisse qui paie (test remise)');
  await caisse.deposit({ admin, caisseId: payer, currency: 'DZD', amount: '50000000' });
});
after(async () => { await db.stop(); });

const pool = () => getPool();
const balanceOf = async (personId) => (await pool().query(
  "SELECT balance FROM person_balances WHERE person_type='personne' AND person_id=$1 AND currency_code='DZD'", [personId])).rows[0]?.balance ?? '0.00';
const caisseBalance = async (id) => (await pool().query(
  "SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code='DZD'", [id])).rows[0]?.balance ?? '0.00';
const ledger = async (personId, type) => (await pool().query(
  'SELECT * FROM person_ledger WHERE person_id=$1 AND type=$2 ORDER BY id', [personId, type])).rows;

// Un ordre dont le fournisseur doit 52 340 : 523.4 pièces à 100 ne marche pas, on prend 1 × 52 340.
async function fournisseurQuiDoit(due = '52340') {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Remise ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `Rem-${n}`, measure: 'quantite', quantity: '1', weight_kg: '1', unitPrice: due }] }] } });
  return { f, o, bonId: o.bons[0].id };
}

test('encaisser 52 000 sur 52 340 et solder : la caisse prend 52 000, le compte tombe à zéro, 340 en remise', async () => {
  const { f, o, bonId } = await fournisseurQuiDoit();
  const before = await caisseBalance(alger);
  assert.equal(await balanceOf(f.id), '-52340.00');

  const bon = await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '52000', settle: true });

  assert.equal(Number(await caisseBalance(alger)) - Number(before), 52000, 'la caisse ne bouge que du montant réel');
  assert.equal(await balanceOf(f.id), '0.00', 'la dette est soldée');
  const remise = await ledger(f.id, 'remise');
  assert.equal(remise.length, 1);
  assert.equal(remise[0].amount, '340.00', 'la différence est une écriture à elle');
  assert.equal(remise[0].ref_bon_id, bonId);

  // Le bon le dit : encaissé 100 % du dû, dont 340 de remise.
  const d = await orders.getOrderDetail(o.id);
  assert.equal(d.totals.collected, '52000.00');
  assert.equal(d.totals.remise, '340.00');
  assert.equal(d.totals.due, '0.00', 'plus rien à encaisser');
  assert.equal(d.pay.pct, 100);
  assert.equal(d.pay.remise, '340.00');
  const payment = bon.payments.find((p) => p.type === 'fee_payment');
  assert.equal(payment.remise, '340.00', 'chaque paiement dit la remise qu’il porte');

  await assert.rejects(() => bons.collectFee({ admin, id: bonId, caisseId: alger }), (e) => e.code === 'CONFLICT', 'rien ne reste à encaisser');
});

test('arrondir AU-DESSUS : 52 500 sur 52 340 — la caisse prend 52 500, 160 de remise négative, compte à zéro', async () => {
  const { f, bonId } = await fournisseurQuiDoit();
  const before = await caisseBalance(alger);
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '52500', settle: true });
  assert.equal(Number(await caisseBalance(alger)) - Number(before), 52500);
  assert.equal(await balanceOf(f.id), '0.00');
  assert.equal((await ledger(f.id, 'remise'))[0].amount, '-160.00', 'on a reçu 160 de plus que le dû');
});

test('un arrondi au-dessus plus large que le pas de la devise est refusé, et ne bouge rien', async () => {
  const { f, bonId } = await fournisseurQuiDoit();
  const before = await caisseBalance(alger);
  await assert.rejects(
    () => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '53000', settle: true }), // 660 > pas 500
    (e) => e.code === 'CONFLICT' && /Arrondi trop large/.test(e.message)
  );
  assert.equal(await caisseBalance(alger), before);
  assert.equal(await balanceOf(f.id), '-52340.00');
  assert.equal((await ledger(f.id, 'remise')).length, 0);
});

test('sans « solder », verser plus que le dû reste refusé et un versement partiel reste un acompte', async () => {
  const { f, bonId } = await fournisseurQuiDoit('10000');
  await assert.rejects(() => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '10001' }), (e) => e.code === 'CONFLICT');
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '4000' });
  assert.equal(await balanceOf(f.id), '-6000.00', 'un acompte ne crée aucune remise');
  assert.equal((await ledger(f.id, 'remise')).length, 0);
  // Puis le reste, soldé à 5 700 : la remise de 300 ne compte que sur ce qui restait.
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '5700', settle: true });
  assert.equal(await balanceOf(f.id), '0.00');
  assert.equal((await ledger(f.id, 'remise'))[0].amount, '300.00');
});

test('le pas d’arrondi se règle dans les paramètres, par devise', async () => {
  await pool().query(
    `INSERT INTO app_settings (key, value) VALUES ('arrondi', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ defaut: 1, pas: { DZD: 1000 } })]);
  try {
    const { f, bonId } = await fournisseurQuiDoit('52340');
    // Au-dessus de 660 : refusé à 500, accepté à 1000.
    await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '53000', settle: true });
    assert.equal(await balanceOf(f.id), '0.00');
  } finally {
    await pool().query("DELETE FROM app_settings WHERE key = 'arrondi'");
  }
});

test('payer le passager avec une remise : la caisse sort le montant réel, le compte tombe à zéro', async () => {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. RP ${n}`])).rows[0];
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager RP ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `RP-${n}`, measure: 'quantite', quantity: '1', weight_kg: '1', unitPrice: '100000' }] }] } });
  // Le passager est payé 52 340 pour porter ce lot.
  const bon = await bons.createBon({ admin, data: { passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: o.lines[0].line_id, measure: 'quantite', quantity: '1', unitPrice: '52340' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.settle({ admin, id: bon.id });
  assert.equal(await balanceOf(p.id), '52340.00', 'on lui doit 52 340');

  const before = await caisseBalance(payer);
  const after = await bons.payPassager({ admin, id: bon.id, caisseId: payer, amount: '52000', settle: true });
  assert.equal(Number(before) - Number(await caisseBalance(payer)), 52000, 'la caisse ne sort que 52 000');
  assert.equal(await balanceOf(p.id), '0.00', 'le compte du passager est soldé');
  assert.equal((await ledger(p.id, 'remise'))[0].amount, '-340.00', 'côté passager, la remise baisse ce qu’on lui doit');
  assert.equal(after.pay.pct, 100);
  assert.equal(after.pay.remise, '340.00');
  await assert.rejects(() => bons.payPassager({ admin, id: bon.id, caisseId: payer }), (e) => e.code === 'CONFLICT', 'plus rien à payer');
});

test('régler le bon ET payer en soldant : une seule transaction, avec remise', async () => {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. RS ${n}`])).rows[0];
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager RS ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `RS-${n}`, measure: 'quantite', quantity: '1', weight_kg: '1', unitPrice: '100000' }] }] } });
  const bon = await bons.createBon({ admin, data: { passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: o.lines[0].line_id, measure: 'quantite', quantity: '1', unitPrice: '30210' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });
  const before = await caisseBalance(payer);
  await bons.settle({ admin, id: bon.id, caisseId: payer, paidNow: '30000', closeWithRemise: true });
  assert.equal(Number(before) - Number(await caisseBalance(payer)), 30000);
  assert.equal(await balanceOf(p.id), '0.00');
});

test('le règlement au comptoir solde dans les deux sens', async () => {
  // Il nous doit 8 240 : il règle 8 000.
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Comptoir ${++seq}`])).rows[0];
  await accounts.createPersonTransaction({ admin, personType: 'personne', personId: f.id, direction: 'out', amount: '8240', type: 'autre', note: 'dette' });
  assert.equal(await balanceOf(f.id), '-8240.00', 'on a avancé : il nous doit 8 240');
  const r = await accounts.settleAccount({ admin, personId: f.id, caisseId: alger, amount: '8000', currency: 'DZD', direction: 'in', settle: true });
  assert.equal(r.balance, '0.00');
  assert.equal((await ledger(f.id, 'remise'))[0].amount, '240.00');

  // On lui doit 8 240 : on lui règle 8 000.
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager Comptoir ${++seq}`])).rows[0];
  await accounts.createPersonTransaction({ admin, personType: 'personne', personId: p.id, direction: 'in', amount: '8240', type: 'avance', note: 'dû' });
  assert.equal(await balanceOf(p.id), '8240.00');
  const before = await caisseBalance(payer);
  const r2 = await accounts.settleAccount({ admin, personId: p.id, caisseId: payer, amount: '8000', currency: 'DZD', direction: 'out', settle: true });
  assert.equal(r2.balance, '0.00');
  assert.equal(Number(before) - Number(await caisseBalance(payer)), 8000);
  assert.equal((await ledger(p.id, 'remise'))[0].amount, '-240.00');

  // Rien à solder : refusé, et rien n'est écrit.
  await assert.rejects(
    () => accounts.settleAccount({ admin, personId: p.id, caisseId: payer, amount: '10', currency: 'DZD', direction: 'out', settle: true }),
    (e) => e.code === 'CONFLICT' && /Rien à solder/.test(e.message)
  );
});

test('annuler le paiement emporte sa remise ; un paiement avec remise ne se corrige pas à la main', async () => {
  const { f, bonId } = await fournisseurQuiDoit('20340');
  const before = await caisseBalance(alger);
  const bon = await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '20000', settle: true });
  const payment = bon.payments.find((p) => p.type === 'fee_payment');

  await assert.rejects(
    () => accounts.updatePayment({ admin, entryId: payment.id, amount: '19000' }),
    (e) => e.code === 'CONFLICT' && /remise/.test(e.message)
  );

  await bons.cancelBonPayment({ admin, id: bonId, entryId: payment.id });
  assert.equal(await balanceOf(f.id), '-20340.00', 'le compte est revenu à la dette d’origine');
  assert.equal((await ledger(f.id, 'remise')).length, 0, 'la remise est partie avec le paiement');
  assert.equal(await caisseBalance(alger), before, 'et la caisse aussi');

  // Refaire le même paiement, puis l'annuler par l'autre chemin (fiche de la personne).
  const again = await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '20000', settle: true });
  await accounts.deletePayment({ admin, entryId: again.payments.find((p) => p.type === 'fee_payment').id });
  assert.equal(await balanceOf(f.id), '-20340.00');
  assert.equal((await ledger(f.id, 'remise')).length, 0);
});

test('un salaire se solde avec une remise ; la supprimer le rouvre', async () => {
  const emp = await employees.createEmployee({
    admin, name: `Salarié Remise ${++seq}`, salary: '52340', currency: 'DZD', caisseId: payer, firstDueOn: new Date().toISOString().slice(0, 10),
  });
  const list = async () => (await employees.listEmployees()).employees.find((x) => x.id === emp.id);
  assert.equal((await list()).balance, '52340.00');

  const before = await caisseBalance(payer);
  const pay = await employees.payEmployee({ admin, id: emp.id, amount: '52000', caisseId: payer, settle: true });
  assert.equal(pay.remise, '340.00');
  assert.equal(Number(before) - Number(await caisseBalance(payer)), 52000, 'la caisse sort 52 000');
  const after = await list();
  assert.equal(after.balance, '0.00', 'le salaire est soldé');
  assert.equal(after.remise_total, '340.00');

  await assert.rejects(() => accounts.updateCharge({ admin, id: pay.id, amount: '1' }), (e) => e.code === 'CONFLICT' && /remise/.test(e.message));
  await accounts.deleteCharge({ admin, id: pay.id });
  assert.equal((await list()).balance, '52340.00', 'supprimer le versement rouvre le salaire');
});

test('la caisse reste égale à la somme de ses mouvements, remises comprises', async () => {
  for (const id of [alger, payer]) {
    const { rows: [r] } = await pool().query(
      `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END), 0) AS s
         FROM transactions WHERE caisse_id=$1 AND currency_code='DZD'`, [id]);
    assert.equal(Number(r.s), Number(await caisseBalance(id)), 'solde = somme des mouvements');
  }
});
