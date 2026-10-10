// La wilaya d'une personne, et la règle « le fournisseur paie en Algérie ».
//
// La règle est testée au SERVEUR : un client qui contourne la liste de l'écran
// ne doit pas pouvoir encaisser dans la caisse du bureau de Chine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse, algeriaTestCaisse } from './helpers/testdb.js';
import * as people from '../src/modules/people/people.service.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as accounts from '../src/modules/accounts/accounts.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin, algeria, china, noOffice;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
  algeria = await algeriaTestCaisse('Caisse Alger (test wilaya)');
  china = (await getPool().query("SELECT id FROM caisses WHERE kind='office' AND office='china'")).rows[0].id;
  noOffice = (await getPool().query(
    "INSERT INTO caisses (kind, office, label) VALUES ('office', NULL, 'Sans bureau (test wilaya)') RETURNING id")).rows[0].id;
});
after(async () => { await db.stop(); });

test('la wilaya se enregistre, se modifie et se cherche', async () => {
  const p = await people.createPerson({ admin, data: { name: 'Karim Wilaya', isPassager: true, wilaya: 'Oran' } });
  assert.equal(p.wilaya, 'Oran');

  const u = await people.updatePerson({ admin, id: p.id, data: { name: 'Karim Wilaya', isPassager: true, wilaya: 'Guangzhou' } });
  assert.equal(u.wilaya, 'Guangzhou', 'un lieu hors d’Algérie est accepté : texte libre');

  const found = await people.listPeople({ search: 'Guangzhou' });
  assert.ok(found.some((x) => x.id === p.id), 'la recherche porte aussi sur la wilaya');

  const cleared = await people.updatePerson({ admin, id: p.id, data: { name: 'Karim Wilaya', isPassager: true } });
  assert.equal(cleared.wilaya, null);
});

async function bonFournisseur(name) {
  const f = (await getPool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [name])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{
    transportCurrency: 'DZD', lines: [{ designation: `${name} lot`, measure: 'quantite', quantity: '10', weight_kg: '20', unitPrice: '100' }] }] } });
  return { f, bonId: o.bons[0].id };
}

test('le fournisseur ne paie qu’en Algérie : la Chine et une caisse sans bureau sont refusées', async () => {
  const { bonId } = await bonFournisseur('Fourn. Alger A');
  for (const caisseId of [china, noOffice]) {
    await assert.rejects(
      () => bons.collectFee({ admin, id: bonId, caisseId, amount: '100' }),
      (e) => e.code === 'CONFLICT' && /Alg[ée]rie/.test(e.message)
    );
  }
  const paid = await bons.collectFee({ admin, id: bonId, caisseId: algeria, amount: '100' });
  assert.equal(paid.payments.filter((x) => x.type === 'fee_payment').length, 1);
});

test('le règlement au comptoir d’un fournisseur suit la même règle, pas celui d’un passager', async () => {
  const { f } = await bonFournisseur('Fourn. Alger B');
  await assert.rejects(
    () => accounts.settleAccount({ admin, personId: f.id, caisseId: china, amount: '50', currency: 'DZD', direction: 'in' }),
    (e) => e.code === 'CONFLICT'
  );
  await accounts.settleAccount({ admin, personId: f.id, caisseId: algeria, amount: '50', currency: 'DZD', direction: 'in' });

  // Un passager qui nous rembourse n'est pas un fournisseur : aucune règle de bureau.
  const p = (await getPool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING id', ['Passager Alger B'])).rows[0];
  await accounts.settleAccount({ admin, personId: p.id, caisseId: china, amount: '10', currency: 'DZD', direction: 'in' });
});
