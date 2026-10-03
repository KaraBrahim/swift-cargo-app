// Les paies : le mois se paie une fois, l'acompte se déduit de la proposition.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, balanceOf } from './helpers/testdb.js';
import { getPool } from '../src/db/pool.js';
import * as emp from '../src/modules/employees/employees.service.js';
import { deposit } from '../src/modules/caisse/caisse.service.js';

let db, admin, caisseId, e;
before(async () => {
  db = await setupTestDb();
  ({ admin } = await firstAdminAndCaisse());
  // Une caisse à ce fichier : les fichiers de test tournent en parallèle sur la
  // même base, et un dépôt dans la caisse de bureau partagée fausse les soldes
  // que caisse.test.js vérifie au même moment.
  const { rows: [c] } = await getPool().query(
    "INSERT INTO caisses (kind, office, label) VALUES ('office', NULL, 'Caisse salaires (test)') RETURNING id"
  );
  caisseId = c.id;
  await getPool().query('INSERT INTO caisse_balances (caisse_id, currency_code) SELECT $1, code FROM currencies ON CONFLICT DO NOTHING', [caisseId]);
  await deposit({ admin, caisseId, currency: 'DZD', amount: '100000', note: 'test', ip: '::1' });
  e = await emp.createEmployee({ admin, name: 'Karim Test', poste: 'Comptoir', salary: '30000', currency: 'DZD', caisseId, ip: '::1' });
});
after(async () => { await db.stop(); });

const me = async () => (await emp.listEmployees()).employees.find((x) => x.id === e.id);

test('le compte s’ouvre sur un mois de salaire dû', async () => {
  const m = await me();
  assert.equal(m.months, 1);
  assert.equal(m.owed_total, '30000.00');
  assert.equal(m.balance, '30000.00');
  assert.equal(m.remaining, '30000.00');
  assert.equal(m.advance, '0.00');
});

test('un versement partiel réduit le solde sans le solder', async () => {
  const before = Number(await balanceOf(caisseId, 'DZD'));
  await emp.payEmployee({ admin, id: e.id, amount: '5000', caisseId, ip: '::1' });

  assert.equal(Number(await balanceOf(caisseId, 'DZD')), before - 5000);
  const m = await me();
  assert.equal(m.paid_this_month, '5000.00');
  assert.equal(m.balance, '25000.00');
});

// Le défaut corrigé : « à jour » alors qu'on avait versé plus que dû. Le surplus
// est une AVANCE, elle vaut pour les mois suivants et doit se voir.
test('verser plus que dû laisse une avance, jamais « à jour »', async () => {
  await emp.payEmployee({ admin, id: e.id, amount: '40000', caisseId, ip: '::1' });
  const m = await me();
  assert.equal(m.paid_total, '45000.00');
  assert.equal(m.balance, '-15000.00', 'le compte est débiteur : il a 15 000 d’avance');
  assert.equal(m.advance, '15000.00');
  assert.equal(m.remaining, '0.00', 'on ne lui doit rien pour l’instant');
});

// L'avance s'impute sur le mois suivant : le salaire court, le compte se
// rapproche de zéro sans qu'on reverse quoi que ce soit.
test('le mois suivant déduit l’avance de ce qui devient dû', async () => {
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1);
  const { employees } = await emp.listEmployees({ period: next.toISOString().slice(0, 7) });
  const m = employees.find((x) => x.id === e.id);
  assert.equal(m.months, 2);
  assert.equal(m.owed_total, '60000.00');
  assert.equal(m.balance, '15000.00', '60 000 dus − 45 000 versés');
});

test('chaque versement est une charge « salaire » rattachée au salarié', async () => {
  const { rows } = await getPool().query("SELECT category, employee_id FROM charges WHERE employee_id = $1", [e.id]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.category === 'salaire' && r.employee_id === e.id));
});
