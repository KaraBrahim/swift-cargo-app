// Les routes, pour de vrai : l'application démarre, on s'y connecte, on appelle.
//
// Les autres tests parlent directement aux services et contournent donc les
// schémas zod des routes — et le chargement des modules de routes. Un schéma qui
// référence une constante pas encore définie plante le serveur AU DÉMARRAGE, sans
// qu'aucun test de service ne s'en aperçoive. Celui-ci ferme ce trou : il passe
// par HTTP, avec les vrais corps que l'écran envoie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, algeriaTestCaisse } from './helpers/testdb.js';
import { createApp } from '../src/app.js';

let db, server, base, token, algeria;

before(async () => {
  db = await setupTestDb();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin1', password: process.env.SEED_ADMIN_PASSWORD }),
  });
  token = (await r.json()).token;
  algeria = await algeriaTestCaisse('Caisse Alger (test http)');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.stop();
});

async function call(method, path, body) {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}
const ok = async (method, path, body, expected = 200) => {
  const r = await call(method, path, body);
  assert.equal(r.status, expected, `${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

test('le parcours complet par HTTP : personne, ordre, bon passager, voyage, agenda, encaissement soldé', async () => {
  // Phase 4 : la wilaya
  const { person: f } = await ok('POST', '/people', { name: 'Fourn. HTTP', isFournisseur: true, wilaya: 'Guangzhou' }, 201);
  const { person: p } = await ok('POST', '/people', { name: 'Passager HTTP', isPassager: true, wilaya: 'Oran' }, 201);
  assert.equal(f.wilaya, 'Guangzhou');

  // Phase 3 : quantité ET poids, par quoi se multiplie le prix ; phase 5 : le retrait prévu
  const { order } = await ok('POST', '/orders', {
    fournisseurId: f.id, pickupExpectedOn: '2035-03-12',
    bons: [{ transportCurrency: 'DZD', lines: [
      { designation: 'Article HTTP', measure: 'poids', quantity: '40', weight_kg: '100', unitPrice: '523.4', unit: 'carton' }] }],
  }, 201);
  assert.equal(order.pickup_expected_on, '2035-03-12');
  assert.equal(order.bons[0].transport_fee, '52340.00', '100 kg × 523.4');
  const lineId = order.lines[0].line_id;

  // Un champ obligatoire manquant est refusé avec un message
  const bad = await call('POST', '/orders', { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD', lines: [
    { designation: 'Sans poids', measure: 'quantite', quantity: '5', unitPrice: '1' }] }] });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.json), /poids/);

  // Phase 5 : le voyage d'un bon passager
  const { bon } = await ok('POST', '/bons', {
    passagerId: p.id, transportCurrency: 'DZD',
    departurePlannedOn: '2035-03-01', arrivalPromisedOn: '2035-03-05',
    airport: 'Houari Boumediene', airportWilaya: 'Alger', airline: 'Air China',
    lines: [{ sourceLineId: lineId, measure: 'quantite', quantity: '10', unitPrice: '5' }],
  }, 201);
  assert.equal(bon.arrival_promised_on, '2035-03-05');
  assert.equal(bon.airport, 'Houari Boumediene');

  const left = await ok('POST', `/bons/${bon.id}/advance`, { date: '2035-03-02' });
  assert.equal(left.bon.departure_actual_on, '2035-03-02');
  const arrived = await ok('POST', `/bons/${bon.id}/advance`, { date: '2035-03-07' });
  assert.equal(arrived.bon.days_late, 2);
  const fixed = await ok('PATCH', `/bons/${bon.id}/travel`, { airline: 'Turkish Airlines', arrivalActualOn: '2035-03-06' });
  assert.equal(fixed.bon.airline, 'Turkish Airlines');
  assert.equal(fixed.bon.arrival_actual_on, '2035-03-06');

  // Phase 6 : les journaux
  const o = (await ok('GET', `/orders/${order.id}`)).order;
  assert.deepEqual(o.journal.map((e) => e.kind).slice(0, 4), ['received', 'allocated', 'departed', 'arrived']);
  assert.ok(Array.isArray(fixed.bon.journal) && fixed.bon.journal.length >= 3);

  // Phase 5 : l'agenda et la carte du tableau de bord
  const ag = await ok('GET', '/agenda?from=2035-03-01&to=2035-03-14&today=2035-03-05');
  assert.equal(ag.days.length, 14);
  assert.ok(ag.days.find((d) => d.date === '2035-03-12').pickups.some((x) => x.id === order.id), 'le retrait du fournisseur apparaît le 12');
  assert.ok(ag.days.find((d) => d.date === '2035-03-05').arrivals.some((x) => x.id === bon.id));
  const sum = await ok('GET', '/agenda/summary?today=2035-03-05');
  assert.equal(sum.today.date, '2035-03-05');
  assert.ok(sum.today.arrivals >= 1);
  const list = await ok('GET', '/bons?dateBy=arrival&from=2035-03-05&to=2035-03-05');
  assert.ok(list.bons.some((b) => b.id === bon.id));
  assert.ok((await ok('GET', '/orders?dateBy=pickup&from=2035-03-12&to=2035-03-12')).orders.some((x) => x.id === order.id));
  const sug = await ok('GET', '/bons/travel-suggestions');
  assert.ok(sug.airports.some((a) => a.value === 'Houari Boumediene' && a.wilaya === 'Alger'));
  await ok('PATCH', `/orders/${order.id}/pickup`, { date: '2035-03-15' });

  // Phase 7 : le pas d'arrondi, puis un encaissement soldé avec remise
  await ok('PUT', '/settings/arrondi', { defaut: 1, pas: { DZD: 500 } });
  assert.equal((await ok('GET', '/settings')).settings.arrondi.pas.DZD, 500);

  const paid = await ok('POST', `/bons/${order.bons[0].id}/collect-fee`, { caisseId: algeria, amount: '52000', settle: true });
  assert.equal(paid.bon.payments[0].remise, '340.00');
  const after = (await ok('GET', `/orders/${order.id}`)).order;
  assert.equal(after.totals.due, '0.00');
  assert.equal(after.pay.remise, '340.00');

  // Le règlement au comptoir par HTTP : refusé hors d'Algérie, accepté en Algérie
  const china = (await ok('GET', '/caisses')).caisses.find((c) => c.office === 'china').id;
  await ok('POST', `/bons/${order.bons[0].id}/collect-fee`, { caisseId: china, amount: '1' }, 409);
});

test('toutes les routes se chargent : les schémas ne référencent rien qui n’existe pas encore', async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  // Chaque liste répond (200) — elles passent toutes par la validation de leur requête.
  for (const path of ['/bons', '/orders', '/people', '/agenda/summary', '/bons/travel-suggestions', '/stock/levels?office=china', '/settings', '/employees']) {
    assert.equal((await call('GET', path)).status, 200, path);
  }
});
