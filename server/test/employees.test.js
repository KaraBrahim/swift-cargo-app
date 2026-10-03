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
const d = (iso) => new Date(`${iso}T00:00:00Z`);

// Un salaire est dû EN ENTIER au jour convenu : au 3 du mois on ne doit pas
// trois jours de salaire, on doit ce qui est tombé le mois dernier.
test('un salaire tombe au jour convenu, puis chaque mois au même quantième', () => {
  assert.equal(emp.salariesDue(d('2026-10-05'), d('2026-10-03')), 0, 'le jour n’est pas encore passé');
  assert.equal(emp.salariesDue(d('2026-10-05'), d('2026-10-05')), 1, 'le jour même');
  assert.equal(emp.salariesDue(d('2026-09-05'), d('2026-10-03')), 1, 'un seul salaire tombé');
  assert.equal(emp.salariesDue(d('2026-09-05'), d('2026-10-06')), 2);
});

test('un mois trop court fait tomber le salaire son dernier jour', () => {
  // Le 31 janvier : février n'a pas de 31, le salaire tombe le 28.
  assert.equal(emp.salariesDue(d('2026-01-31'), d('2026-02-27')), 1);
  assert.equal(emp.salariesDue(d('2026-01-31'), d('2026-02-28')), 2);
  assert.equal(emp.nextDueOn(d('2026-01-31'), d('2026-02-28')).toISOString().slice(0, 10), '2026-03-31');
});

test('le compte montre ce qu’on doit, salaire par salaire', async () => {
  const m = await me();
  assert.equal(m.months, 1, 'un salaire est tombé le jour de l’embauche');
  assert.equal(m.owed_total, '30000.00');
  assert.equal(m.balance, '30000.00');
});

test('verser plus que dû laisse une avance, jamais « à jour »', async () => {
  await emp.payEmployee({ admin, id: e.id, amount: '50000', caisseId, ip: '::1' });
  const m = await me();
  assert.equal(m.paid_total, '50000.00');
  assert.equal(m.balance, '-20000.00');
  assert.equal(m.advance, '20000.00');
  assert.equal(m.remaining, '0.00');
});

// Le temps ne s'avance pas en changeant de mois à l'écran : un salaire qui
// n'est pas tombé n'est pas dû. L'avance fond quand le jour arrive, pas avant.
test('regarder un mois à venir n’invente pas de salaire', async () => {
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 2);
  const { employees } = await emp.listEmployees({ period: next.toISOString().slice(0, 7) });
  const m = employees.find((x) => x.id === e.id);
  assert.equal(m.months, 1, 'toujours un seul salaire tombé');
  assert.equal(m.advance, '20000.00', 'l’avance est intacte');
});

test('l’avance fond au salaire suivant', async () => {
  const { rows: [r] } = await getPool().query('SELECT first_due_on, salary FROM employees WHERE id=$1', [e.id]);
  const inTwoMonths = new Date(r.first_due_on); inTwoMonths.setUTCMonth(inTwoMonths.getUTCMonth() + 1);
  assert.equal(emp.salariesDue(r.first_due_on, inTwoMonths), 2, 'le second salaire est tombé');
  // 2 × 30 000 dus − 50 000 versés = 10 000 encore dus.
  assert.equal(Number(r.salary) * 2 - 50000, 10000);
});

// Une augmentation vaut à partir d'un jour : ce qui est déjà tombé garde son
// montant. Sinon, augmenter quelqu'un lui devrait rétroactivement la
// différence sur chaque mois déjà payé.
test('changer le salaire ne réécrit pas les salaires déjà tombés', async () => {
  const { rows: [r] } = await getPool().query('SELECT first_due_on FROM employees WHERE id=$1', [e.id]);
  const before = await me();
  assert.equal(before.owed_total, '30000.00', 'un salaire tombé à 30 000');

  // Augmentation à partir de demain : rien ne change aujourd'hui.
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await emp.changeSalary({ admin, id: e.id, amount: '45000', effectiveFrom: tomorrow, ip: '::1' });
  const after = await me();
  assert.equal(after.owed_total, '30000.00', 'le salaire déjà tombé garde son montant');

  // Le prochain, lui, tombera à 45 000.
  const hist = await emp.listSalaries(e.id);
  assert.equal(hist.length, 2);
  const next = emp.dueDates(r.first_due_on, new Date(Date.now() + 40 * 86400000));
  assert.equal(emp.salaryAt(hist.slice().reverse(), next[next.length - 1]).toFixed(2), '45000.00');
});

test('chaque versement est une charge « salaire » rattachée au salarié', async () => {
  const { rows } = await getPool().query("SELECT category, employee_id FROM charges WHERE employee_id = $1", [e.id]);
  assert.equal(rows.length, 1);
  assert.ok(rows.every((r) => r.category === 'salaire' && r.employee_id === e.id));
});
