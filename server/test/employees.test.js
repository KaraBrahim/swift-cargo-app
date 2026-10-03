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

// Le salaire se gagne jour après jour. Compter des mois entiers faisait deux
// salaires à qui arrivait le 20 du mois précédent : son mois d'embauche valait
// un mois plein, et le suivant aussi dès le 1er.
test('un mois complet vaut exactement un salaire', () => {
  assert.equal(emp.accrued('70000', d('2026-09-01'), d('2026-09-30')).toFixed(2), '70000.00');
  assert.equal(emp.accrued('70000', d('2026-09-01'), d('2026-10-31')).toFixed(2), '140000.00');
});

test('un mois entamé compte ses jours, pas le mois entier', () => {
  // Embauché le 20 septembre : 11 jours sur 30.
  assert.equal(emp.accrued('70000', d('2026-09-20'), d('2026-09-30')).toFixed(2), '25666.67');
  // Puis trois jours d'octobre, sur 31 — et non un second salaire entier.
  assert.equal(emp.accrued('70000', d('2026-09-20'), d('2026-10-03')).toFixed(2), '32440.86');
});

test('embauché aujourd’hui, un seul jour est dû', () => {
  const t = d('2026-10-03');
  assert.equal(emp.accrued('70000', t, t).toFixed(2), '2258.06');
});

test('le compte part de ce qui est acquis, pas d’un mois plein', async () => {
  const m = await me();
  assert.ok(Number(m.owed_total) > 0 && Number(m.owed_total) <= 30000, `acquis inattendu : ${m.owed_total}`);
  assert.equal(m.balance, m.owed_total);
  assert.equal(m.advance, '0.00');
});

test('verser plus que l’acquis laisse une avance, jamais « à jour »', async () => {
  await emp.payEmployee({ admin, id: e.id, amount: '50000', caisseId, ip: '::1' });
  const m = await me();
  assert.equal(m.paid_total, '50000.00');
  assert.ok(Number(m.balance) < 0, 'le compte est débiteur');
  assert.equal(m.advance, (50000 - Number(m.owed_total)).toFixed(2));
  assert.equal(m.remaining, '0.00');
});

test('chaque versement est une charge « salaire » rattachée au salarié', async () => {
  const { rows } = await getPool().query("SELECT category, employee_id FROM charges WHERE employee_id = $1", [e.id]);
  assert.equal(rows.length, 1);
  assert.ok(rows.every((r) => r.category === 'salaire' && r.employee_id === e.id));
});
