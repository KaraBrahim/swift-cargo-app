// Les dates d'un voyage et l'agenda.
//
// Les dates sont écrites « AAAA-MM-JJ » et doivent ressortir telles quelles, sur
// n'importe quelle machine : un fuseau horaire qui décale « le 14 » en « le 13 »
// ferait venir les gens un jour trop tôt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import * as agenda from '../src/modules/agenda/agenda.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
});
after(async () => { await db.stop(); });

const pool = () => getPool();

async function lot() {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Voyage ${n}`])).rows[0];
  const p = (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager Voyage ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `Voy-Lot ${n}`, measure: 'quantite', quantity: '100', weight_kg: '200', unitPrice: '50' }] }] } });
  return { n, f, p, o, lineId: o.lines[0].line_id };
}

const passagerBon = (x, travel = {}) => bons.createBon({ admin, data: {
  passagerId: x.p.id, transportCurrency: 'DZD',
  lines: [{ sourceLineId: x.lineId, measure: 'quantite', quantity: '10', unitPrice: '5' }], ...travel } });

test('les dates et le vol d’un bon passager ressortent exactement comme saisis', async () => {
  const x = await lot();
  const b = await passagerBon(x, {
    departurePlannedOn: '2031-03-01', arrivalPromisedOn: '2031-03-05',
    airport: 'Houari Boumediene', airportWilaya: 'Alger', airline: 'Air China',
  });
  assert.equal(b.departure_planned_on, '2031-03-01');
  assert.equal(b.arrival_promised_on, '2031-03-05');
  assert.equal(b.airport, 'Houari Boumediene');
  assert.equal(b.airport_wilaya, 'Alger');
  assert.equal(b.airline, 'Air China');
  assert.equal(b.departure_actual_on, null, 'rien de réel tant que le bon n’est pas parti');
});

test('une date qui n’existe pas, ou une arrivée avant le départ, est refusée', async () => {
  const x = await lot();
  await assert.rejects(() => passagerBon(x, { arrivalPromisedOn: '2031-02-30' }), (e) => /date invalide/.test(JSON.stringify(e.details)));
  await assert.rejects(() => passagerBon(x, { arrivalPromisedOn: 'demain' }), (e) => e.code === 'VALIDATION' || e.status === 400);
  await assert.rejects(
    () => passagerBon(x, { departurePlannedOn: '2031-03-10', arrivalPromisedOn: '2031-03-05' }),
    (e) => /précéder/.test(JSON.stringify(e.details))
  );
});

test('avancer écrit les dates réelles ; revenir en arrière les efface', async () => {
  const x = await lot();
  const b = await passagerBon(x, { departurePlannedOn: '2031-04-01', arrivalPromisedOn: '2031-04-04' });

  const left = await bons.advanceStatus({ admin, id: b.id, date: '2031-04-02' });
  assert.equal(left.departure_actual_on, '2031-04-02', 'il est parti un jour en retard');
  assert.equal(left.arrival_actual_on, null);

  const arrived = await bons.advanceStatus({ admin, id: b.id, date: '2031-04-07' });
  assert.equal(arrived.arrival_actual_on, '2031-04-07');
  assert.equal(arrived.days_late, 3, 'arrivé 3 jours après la date promise');

  const back = await bons.setBonStatus({ admin, id: b.id, target: 'en_transit' });
  assert.equal(back.arrival_actual_on, null, 'annuler l’arrivée efface sa date');
  assert.equal(back.departure_actual_on, '2031-04-02');
  const start = await bons.setBonStatus({ admin, id: b.id, target: 'cree' });
  assert.equal(start.departure_actual_on, null);
});

test('un bon en route dont la date promise est dépassée compte ses jours de retard', async () => {
  const x = await lot();
  const b = await passagerBon(x, { arrivalPromisedOn: '2020-01-01' });
  assert.ok(b.days_overdue > 365, 'créé, promis en 2020 : très en retard');
  await bons.advanceStatus({ admin, id: b.id });
  const arrived = await bons.advanceStatus({ admin, id: b.id, date: '2020-01-04' });
  assert.equal(arrived.days_overdue, null, 'arrivé : ce n’est plus un retard en cours');
  assert.equal(arrived.days_late, 3);
});

test('le voyage se corrige à tout moment, dates réelles comprises, mais pas sur un bon fournisseur', async () => {
  const x = await lot();
  const b = await passagerBon(x, { airport: 'Oran Es Senia' });
  await bons.advanceStatus({ admin, id: b.id });
  await bons.advanceStatus({ admin, id: b.id, date: '2031-05-09' });

  const fixed = await bons.updateTravel({ admin, id: b.id, data: {
    airport: 'Oran Ahmed Ben Bella', airline: 'Turkish Airlines', arrivalActualOn: '2031-05-08' } });
  assert.equal(fixed.airport, 'Oran Ahmed Ben Bella');
  assert.equal(fixed.airline, 'Turkish Airlines');
  assert.equal(fixed.arrival_actual_on, '2031-05-08');

  const cleared = await bons.updateTravel({ admin, id: b.id, data: { airline: '' } });
  assert.equal(cleared.airline, null, 'vide efface');
  assert.equal(cleared.airport, 'Oran Ahmed Ben Bella', 'absent ne touche pas');

  await assert.rejects(
    () => bons.updateTravel({ admin, id: x.o.bons[0].id, data: { airline: 'X' } }),
    (e) => e.code === 'CONFLICT'
  );
  await assert.rejects(
    () => bons.updateTravel({ admin, id: b.id, data: { departureActualOn: '2031-05-10', arrivalActualOn: '2031-05-08' } }),
    (e) => /précéder/.test(JSON.stringify(e.details))
  );
});

test('modifier les marchandises d’un bon ne perd pas son voyage', async () => {
  const x = await lot();
  const b = await passagerBon(x, { airport: 'Constantine', airline: 'Air Algérie', arrivalPromisedOn: '2031-06-01' });
  const u = await bons.updateBon({ admin, id: b.id, data: {
    lines: [{ sourceLineId: x.lineId, measure: 'quantite', quantity: '20', unitPrice: '5' }] } });
  assert.equal(u.airport, 'Constantine');
  assert.equal(u.airline, 'Air Algérie');
  assert.equal(u.arrival_promised_on, '2031-06-01');
});

test('les aéroports et compagnies déjà saisis sont proposés, du plus fréquent au moins fréquent', async () => {
  const tag = `Aéroport-${++seq}`;
  const x = await lot();
  await passagerBon(x, { airport: tag, airportWilaya: 'Tlemcen', airline: `Cie-${tag}` });
  await passagerBon(x, { airport: tag, airportWilaya: 'Tlemcen', airline: `Cie-${tag}` });
  await passagerBon(x, { airport: tag, airportWilaya: 'Oran' });
  const s = await bons.travelSuggestions();
  const a = s.airports.find((r) => r.value === tag);
  assert.equal(a.n, 3);
  assert.equal(a.wilaya, 'Tlemcen', 'la wilaya la plus fréquente pour cet aéroport');
  assert.equal(s.airlines.find((r) => r.value === `Cie-${tag}`).n, 2);
});

test('le retrait prévu d’un fournisseur se pose, se change et s’efface', async () => {
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Retrait ${++seq}`])).rows[0];
  const mk = (extra) => orders.createOrder({ admin, data: { fournisseurId: f.id, ...extra, bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `Retrait ${seq}`, measure: 'quantite', quantity: '5', weight_kg: '5', unitPrice: '10' }] }] } });
  const o = await mk({ pickupExpectedOn: '2031-07-15' });
  assert.equal(o.pickup_expected_on, '2031-07-15');
  assert.equal((await orders.setPickupDate({ admin, id: o.id, date: '2031-07-20' })).pickup_expected_on, '2031-07-20');
  assert.equal((await orders.setPickupDate({ admin, id: o.id, date: '' })).pickup_expected_on, null);
  await assert.rejects(() => mk({ pickupExpectedOn: '2031-13-40' }), (e) => /date invalide/.test(JSON.stringify(e.details)));
});

test('l’agenda dit qui vient quel jour, y compris les jours vides et les retards', async () => {
  const x = await lot();
  const arriving = await passagerBon(x, { arrivalPromisedOn: '2032-02-10', departurePlannedOn: '2032-02-08', airport: 'Alger', airline: 'Air China' });
  const late = await passagerBon(x, { arrivalPromisedOn: '2032-02-01' });
  await bons.advanceStatus({ admin, id: late.id });
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Agenda ${++seq}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, pickupExpectedOn: '2032-02-11', bons: [{ transportCurrency: 'DZD',
    lines: [{ designation: `Agenda ${seq}`, measure: 'quantite', quantity: '5', weight_kg: '5', unitPrice: '10' }] }] } });

  const a = await agenda.agenda({ from: '2032-02-08', to: '2032-02-12', today: '2032-02-09' });
  assert.equal(a.days.length, 5, 'tous les jours de l’intervalle, même vides');
  const d = (iso) => a.days.find((x) => x.date === iso);
  assert.ok(d('2032-02-08').departures.some((r) => r.id === arriving.id));
  assert.ok(d('2032-02-10').arrivals.some((r) => r.id === arriving.id));
  assert.equal(d('2032-02-09').arrivals.length, 0);
  assert.ok(d('2032-02-11').pickups.some((r) => r.id === o.id));
  const row = d('2032-02-10').arrivals.find((r) => r.id === arriving.id);
  assert.equal(row.airport, 'Alger');
  assert.equal(row.arrival_promised_on, '2032-02-10');
  assert.equal(Number(row.quantity), 10);

  const lateRow = a.overdue.find((r) => r.id === late.id);
  assert.equal(lateRow.days_overdue, 8, 'promis le 1er, on est le 9');
  assert.ok(!a.overdue.some((r) => r.id === arriving.id), 'pas encore promis ce jour : pas en retard');

  await assert.rejects(() => agenda.agenda({ from: '2032-02-12', to: '2032-02-08' }), (e) => e.code === 'VALIDATION' || e.status === 400);
});

test('le résumé du tableau de bord compte aujourd’hui et demain', async () => {
  const x = await lot();
  await passagerBon(x, { arrivalPromisedOn: '2033-05-10' });
  await passagerBon(x, { arrivalPromisedOn: '2033-05-10' });
  await passagerBon(x, { arrivalPromisedOn: '2033-05-11' });
  const s = await agenda.agendaSummary({ today: '2033-05-10' });
  assert.equal(s.today.arrivals, 2);
  assert.equal(s.tomorrow.arrivals, 1);
  assert.equal(s.today.date, '2033-05-10');
  assert.equal(s.tomorrow.date, '2033-05-11');
});

test('la liste des bons se filtre par jour — création, départ prévu ou arrivée promise', async () => {
  const x = await lot();
  const b = await passagerBon(x, { departurePlannedOn: '2034-01-02', arrivalPromisedOn: '2034-01-06' });
  const by = (dateBy, from, to) => bons.listBons({ dateBy, from, to, passagerId: x.p.id });
  assert.deepEqual((await by('arrival', '2034-01-05', '2034-01-07')).map((r) => r.id), [b.id]);
  assert.equal((await by('arrival', '2034-01-07', '2034-01-09')).length, 0);
  assert.deepEqual((await by('departure', '2034-01-01', '2034-01-02')).map((r) => r.id), [b.id]);
  assert.equal((await by('created', '2034-01-01', '2034-01-31')).length, 0, 'créé aujourd’hui, pas en 2034');
  const row = (await by('arrival', '2034-01-06', '2034-01-06'))[0];
  assert.equal(row.arrival_promised_on, '2034-01-06', 'la liste aussi rend les dates telles que saisies');
});
