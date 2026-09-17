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

test('la proposition part du salaire configuré', async () => {
  assert.equal((await me()).suggested, '30000.00');
});

test('un acompte sort de la caisse et se déduit du mois proposé', async () => {
  const before = Number(await balanceOf(caisseId, 'DZD'));
  await emp.payEmployee({ admin, id: e.id, amount: '5000', kind: 'acompte', ip: '::1' });
  assert.equal(Number(await balanceOf(caisseId, 'DZD')), before - 5000);
  const m = await me();
  assert.equal(m.advances_this_month, '5000.00');
  assert.equal(m.suggested, '25000.00');
});

test('le mois se paie une fois, et devient la base du mois suivant', async () => {
  await emp.payEmployee({ admin, id: e.id, amount: '25000', kind: 'mensuel', ip: '::1' });
  const m = await me();
  assert.equal(m.month_paid, true);
  assert.equal(m.paid_this_month, '30000.00');
  assert.equal(m.suggested_base, '25000.00', 'le dernier mensuel versé devient la proposition');
  await assert.rejects(emp.payEmployee({ admin, id: e.id, amount: '1', kind: 'mensuel', ip: '::1' }), /déjà payé/);
});

test('la paie est une charge « salaire » rattachée au salarié', async () => {
  const { rows } = await getPool().query("SELECT category, kind, employee_id FROM charges WHERE employee_id = $1", [e.id]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.category === 'salaire' && r.employee_id === e.id));
});
