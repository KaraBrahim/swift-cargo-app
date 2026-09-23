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
  const m = await me();
  assert.equal(m.base, '30000.00');
  assert.equal(m.remaining, '30000.00');
});

// Un versement partiel EST l'acompte : plus de mode à choisir, juste un montant.
test('un versement sort de la caisse et diminue ce qui reste', async () => {
  const before = Number(await balanceOf(caisseId, 'DZD'));
  await emp.payEmployee({ admin, id: e.id, amount: '5000', caisseId, ip: '::1' });

  assert.equal(Number(await balanceOf(caisseId, 'DZD')), before - 5000);
  const m = await me();
  assert.equal(m.paid_this_month, '5000.00');
  assert.equal(m.remaining, '25000.00');
});

test('solder le mois met le reste à zéro, et verser plus reste permis', async () => {
  await emp.payEmployee({ admin, id: e.id, amount: '25000', caisseId, ip: '::1' });
  let m = await me();
  assert.equal(m.paid_this_month, '30000.00');
  assert.equal(m.remaining, '0.00', 'le mois est à jour');

  // Une prime : de l'argent réellement sorti, jamais refusé.
  await emp.payEmployee({ admin, id: e.id, amount: '2000', caisseId, note: 'prime', ip: '::1' });
  m = await me();
  assert.equal(m.paid_this_month, '32000.00');
  assert.equal(m.remaining, '0.00');
});

// La demande d'origine : le mois suivant propose ce qu'on a réellement versé.
test('le mois suivant propose ce qui a été versé le mois précédent', async () => {
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1);
  const period = next.toISOString().slice(0, 7);
  const { employees } = await emp.listEmployees({ period });
  const m = employees.find((x) => x.id === e.id);
  assert.equal(m.base, '32000.00', 'le versé du mois dernier fait la proposition');
  assert.equal(m.remaining, '32000.00');
});

test('chaque versement est une charge « salaire » rattachée au salarié', async () => {
  const { rows } = await getPool().query("SELECT category, employee_id FROM charges WHERE employee_id = $1", [e.id]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.category === 'salaire' && r.employee_id === e.id));
});
