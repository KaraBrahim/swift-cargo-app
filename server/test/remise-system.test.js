// Le système de remises complet : un montant, un pourcentage, un arrondi, un solde,
// chacun avec son motif — et le rapport qui les rassemble.
//
// Ce que ces tests tiennent :
//   · le SERVEUR recalcule le pourcentage, et borne versement + remise au dû ;
//   · la caisse ne bouge que du montant réellement versé ;
//   · le motif est validé (inconnu ou désactivé = refus) et reste lisible sur le bon ;
//   · le rapport dit le sens (accordée / obtenue) et totalise devise par devise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, algeriaTestCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import * as caisse from '../src/modules/caisse/caisse.service.js';
import * as employees from '../src/modules/employees/employees.service.js';
import * as remises from '../src/modules/remises/remises.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, alger, payer, reasonId, today;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
  alger = await algeriaTestCaisse('Caisse Alger (test remises)');
  payer = await algeriaTestCaisse('Caisse qui paie (test remises)');
  await caisse.deposit({ admin, caisseId: payer, currency: 'DZD', amount: '50000000' });
  reasonId = (await remises.listReasons()).find((r) => r.label === 'Geste commercial').id;
  today = new Date().toISOString().slice(0, 10);
});
after(async () => { await db.stop(); });

const pool = () => getPool();
const balanceOf = async (personId) => (await pool().query(
  "SELECT balance FROM person_balances WHERE person_type='personne' AND person_id=$1 AND currency_code='DZD'", [personId])).rows[0]?.balance ?? '0.00';
const caisseBalance = async (id) => Number((await pool().query(
  "SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code='DZD'", [id])).rows[0]?.balance ?? 0);
const remiseRows = async (personId) => (await pool().query(
  "SELECT * FROM person_ledger WHERE person_id=$1 AND type='remise' ORDER BY id", [personId])).rows;

async function fournisseurQuiDoit(due) {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Système ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `Sys-${n}`, measure: 'quantite', quantity: '1', weight_kg: '1', unitPrice: String(due) }] }] } });
  return { f, o, bonId: o.bons[0].id };
}

test('un montant de remise : on verse 600, on laisse tomber 400, la dette de 1 000 est soldée', async () => {
  const { f, bonId } = await fournisseurQuiDoit(1000);
  const before = await caisseBalance(alger);
  const bon = await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '600',
    remise: { kind: 'amount', value: '400', reasonId, note: 'ancien client' } });

  assert.equal(await caisseBalance(alger) - before, 600, 'la caisse ne prend que le versé');
  assert.equal(await balanceOf(f.id), '0.00');
  const [r] = await remiseRows(f.id);
  assert.equal(r.amount, '400.00');
  assert.equal(r.remise_kind, 'amount');
  assert.equal(r.remise_reason_id, reasonId);
  assert.equal(r.note, 'ancien client');

  const p = bon.payments.find((x) => x.type === 'fee_payment');
  assert.equal(p.remise_info.kind, 'amount');
  assert.equal(p.remise_info.reason, 'Geste commercial', 'le bon dit le motif à côté du montant');
});

test('un pourcentage : 5 % de 52 340, recalculé par le serveur', async () => {
  const { f, bonId } = await fournisseurQuiDoit(52340);
  // 5 % de 52 340 = 2 617 : le client verse le reste, 49 723.
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '49723', remise: { kind: 'percent', value: '5' } });
  assert.equal(await balanceOf(f.id), '0.00');
  const [r] = await remiseRows(f.id);
  assert.equal(r.amount, '2617.00');
  assert.equal(r.remise_kind, 'percent');
  assert.equal(Number(r.remise_percent), 5);
});

test('versement + remise ne dépassent jamais le dû', async () => {
  const { f, bonId } = await fournisseurQuiDoit(1000);
  await assert.rejects(
    () => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '700', remise: { kind: 'amount', value: '400' } }),
    (e) => e.code === 'CONFLICT' && /dépassent le dû/.test(e.message)
  );
  await assert.rejects(
    () => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '100', remise: { kind: 'percent', value: '150' } }),
    (e) => e.code === 'INVALID_AMOUNT'
  );
  assert.equal(await balanceOf(f.id), '-1000.00', 'rien n’a bougé');
});

test('une remise sans solder laisse le reste dû : 200 versés + 100 de remise sur 1 000', async () => {
  const { f, bonId } = await fournisseurQuiDoit(1000);
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '200', remise: { kind: 'amount', value: '100' } });
  assert.equal(await balanceOf(f.id), '-700.00', 'il reste 700 à encaisser');
});

test('le motif : inconnu ou désactivé, refusé', async () => {
  const { bonId } = await fournisseurQuiDoit(1000);
  await assert.rejects(
    () => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '900', remise: { kind: 'amount', value: '100', reasonId: 999999 } }),
    (e) => e.code === 'VALIDATION'
  );
  const r = await remises.createReason({ admin, label: `Motif éteint ${++seq}` });
  await remises.updateReason({ admin, id: r.id, active: false });
  await assert.rejects(
    () => bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '900', remise: { kind: 'amount', value: '100', reasonId: r.id } }),
    (e) => e.code === 'CONFLICT' && /plus utilisé/.test(e.message)
  );
});

test('« solder » d’avant fonctionne toujours, sous le nom de la sorte « solder »', async () => {
  const { f, bonId } = await fournisseurQuiDoit(52340);
  await bons.collectFee({ admin, id: bonId, caisseId: alger, amount: '52000', settle: true });
  const [r] = await remiseRows(f.id);
  assert.equal(r.amount, '340.00');
  assert.equal(r.remise_kind, 'settle');
});

test('une remise sur un règlement de compte (fiche de la personne)', async () => {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Compte ${n}`])).rows[0];
  await accounts.appendEntry(pool(), { personType: 'personne', personId: f.id, currency: 'DZD', amount: '-2000', type: 'adjustment', adminId: admin.id });
  await accounts.settleAccount({ admin, personId: f.id, caisseId: alger, amount: '1800', currency: 'DZD', direction: 'in',
    remise: { kind: 'percent', value: '10', reasonId } });
  assert.equal(await balanceOf(f.id), '0.00', '1 800 versés + 10 % de 2 000 (200) soldent les 2 000');
  assert.equal((await remiseRows(f.id))[0].amount, '200.00');
});

test('payer le passager avec une remise en pourcentage : le sens est « obtenue »', async () => {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. RP ${n}`])).rows[0];
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager Sys ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `RP-${n}`, measure: 'quantite', quantity: '1', weight_kg: '1', unitPrice: '100000' }] }] } });
  const bon = await bons.createBon({ admin, data: { passagerId: p.id, transportCurrency: 'DZD',
    lines: [{ sourceLineId: o.lines[0].line_id, measure: 'quantite', quantity: '1', unitPrice: '10000' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.settle({ admin, id: bon.id });

  const before = await caisseBalance(payer);
  await bons.payPassager({ admin, id: bon.id, caisseId: payer, amount: '9000', remise: { kind: 'percent', value: '10', reasonId } });
  assert.equal(before - await caisseBalance(payer), 9000);
  assert.equal(await balanceOf(p.id), '0.00');
  const [r] = await remiseRows(p.id);
  assert.equal(r.amount, '-1000.00', 'du côté passager, le grand livre écrit la remise en négatif');
});

test('un salaire avec une remise en montant garde sa sorte et son motif', async () => {
  const emp = await employees.createEmployee({
    admin, name: `Salarié Système ${++seq}`, salary: '50000', currency: 'DZD', caisseId: payer, firstDueOn: today,
  });
  const pay = await employees.payEmployee({ admin, id: emp.id, amount: '45000', caisseId: payer,
    remise: { kind: 'amount', value: '5000', reasonId, note: 'avance déjà donnée' } });
  assert.equal(pay.remise, '5000.00');
  const { rows: [er] } = await pool().query('SELECT * FROM employee_remises WHERE charge_id = $1', [pay.id]);
  assert.equal(er.kind, 'amount');
  assert.equal(er.reason_id, reasonId);
  assert.equal(er.note, 'avance déjà donnée');
});

test('le rapport : sens, totaux par devise et par motif, filtres', async () => {
  const all = await remises.report({ from: today, to: today });
  assert.ok(all.remises.length >= 6, 'toutes les remises du jour y sont');
  const obtenue = all.remises.find((r) => r.amount === '1000.00' && r.kind === 'percent');
  assert.equal(obtenue.direction, 'obtenue', 'payer moins qu’on ne devait = obtenue');
  const accorde = all.remises.find((r) => r.kind === 'percent' && r.amount === '2617.00');
  assert.equal(accorde.direction, 'accordee', 'un fournisseur qui paie moins = remise accordée');

  const dzd = all.totals.byCurrency.find((t) => t.currency_code === 'DZD');
  assert.ok(Number(dzd.accordee) > 0 && Number(dzd.obtenue) > 0);
  assert.equal(Number(dzd.net), Number(dzd.obtenue) - Number(dzd.accordee));
  assert.ok(all.totals.byReason.some((t) => t.reason === 'Geste commercial'));

  const onlyGiven = await remises.report({ from: today, to: today, direction: 'accordee' });
  assert.ok(onlyGiven.remises.every((r) => r.direction === 'accordee'));
  const onlyReason = await remises.report({ from: today, to: today, reasonId });
  assert.ok(onlyReason.remises.every((r) => r.reason_id === reasonId));
  const none = await remises.report({ from: '2001-01-01', to: '2001-01-02' });
  assert.equal(none.remises.length, 0);
});

test('les motifs : un doublon (même à la casse près) est refusé, désactiver le retire de la liste', async () => {
  const label = `Motif test ${++seq}`;
  const r = await remises.createReason({ admin, label });
  await assert.rejects(() => remises.createReason({ admin, label: label.toUpperCase() }), (e) => e.code === 'CONFLICT');
  await remises.updateReason({ admin, id: r.id, active: false });
  assert.ok(!(await remises.listReasons()).some((x) => x.id === r.id), 'plus proposé au comptoir');
  assert.ok((await remises.listReasons({ includeInactive: true })).some((x) => x.id === r.id), 'mais gardé pour l’historique');
});
