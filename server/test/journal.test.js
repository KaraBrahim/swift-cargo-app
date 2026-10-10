// Le journal de la marchandise : ce qui est arrivé à chaque ligne, dans l'ordre,
// et où elle en est APRÈS chaque événement.
//
// C'est la pièce la plus importante du métier : « que s'est-il passé pour cette
// marchandise ? » doit avoir une réponse complète — confiée en deux fois à deux
// passagers, arrivée avec un manquant, remise en deux fois, remise annulée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import * as bons from '../src/modules/bons/bons.service.js';
import * as orders from '../src/modules/orders/orders.service.js';
import { getPool } from '../src/db/pool.js';

let db, admin;
let seq = 0;

before(async () => {
  db = await setupTestDb();
  admin = (await firstAdminAndCaisse()).admin;
});
after(async () => { await db.stop(); });

const pool = () => getPool();
const kinds = (j, lineId) => j.filter((e) => !lineId || String(e.line_id) === String(lineId)).map((e) => e.kind);

async function setup(lines) {
  const n = ++seq;
  const f = (await pool().query('INSERT INTO people (name, is_fournisseur) VALUES ($1, true) RETURNING *', [`Fourn. Journal ${n}`])).rows[0];
  const mkPassager = async (tag) => (await pool().query('INSERT INTO people (name, is_passager) VALUES ($1, true) RETURNING *', [`Passager ${tag} ${n}`])).rows[0];
  const o = await orders.createOrder({ admin, data: { fournisseurId: f.id, bons: [{ transportCurrency: 'DZD',
    lines: lines.map((l, i) => ({ designation: `Jrn-${n}-${i}`, measure: 'quantite', quantity: String(l.q), weight_kg: String(l.w), unitPrice: '100' })) }] } });
  return { n, f, o, mkPassager, lineIds: o.lines.map((l) => l.line_id) };
}

const carry = (x, p, lineId, q, travel = {}) => bons.createBon({ admin, data: {
  passagerId: p.id, transportCurrency: 'DZD', ...travel,
  lines: [{ sourceLineId: lineId, measure: 'quantite', quantity: String(q), unitPrice: '10' }] } });

test('toute la vie d’une ligne se lit : reçue, confiée à deux passagers, arrivée, remise, annulée', async () => {
  const x = await setup([{ q: 40, w: 100 }]);
  const [lineId] = x.lineIds;
  const p1 = await x.mkPassager('A');
  const p2 = await x.mkPassager('B');

  const b1 = await carry(x, p1, lineId, 25);
  const b2 = await carry(x, p2, lineId, 15);
  await bons.advanceStatus({ admin, id: b1.id, date: '2031-08-02' });
  await bons.advanceStatus({ admin, id: b1.id, date: '2031-08-05' });
  const l1 = (await bons.getBonDetail(b1.id)).lines[0];
  await bons.reconcile({ admin, id: b1.id, lines: [{ lineId: l1.id, missing: '5', responsible: 'Douane' }] });
  await bons.advanceStatus({ admin, id: b2.id });
  await bons.advanceStatus({ admin, id: b2.id });

  await orders.deliverOrder({ admin, id: x.o.id, lines: [{ lineId, quantity: '10' }] });
  await orders.deliverOrder({ admin, id: x.o.id, lines: [{ lineId, quantity: '5' }] });
  let d = await orders.getOrderDetail(x.o.id);
  const j = d.journal;

  assert.equal(j[0].kind, 'received');
  assert.equal(j[0].quantity, '40.000');
  assert.equal(j[0].weight_kg, '100.000');
  assert.deepEqual(j[0].after, { china: '40.000', transit: '0.000', office: '0.000', delivered: '0.000', missing: '0.000' });

  const allocated = j.filter((e) => e.kind === 'allocated');
  assert.deepEqual(allocated.map((e) => [e.person.split(' ')[1], e.quantity]), [['A', '25.000'], ['B', '15.000']], 'confié à deux passagers, en deux fois');
  assert.deepEqual(allocated[0].after, { china: '15.000', transit: '25.000', office: '0.000', delivered: '0.000', missing: '0.000' });
  assert.equal(allocated[0].weight_kg, '62.500', 'le poids suit : 25 sur 40 de 100 kg');

  const departed = j.find((e) => e.kind === 'departed' && e.bon_id === b1.id);
  assert.equal(departed.day, '2031-08-02', 'le jour RÉEL du départ');

  const arrived = j.find((e) => e.kind === 'arrived' && e.bon_id === b1.id);
  assert.equal(arrived.quantity, '20.000', '25 partis, 5 manquants');
  assert.equal(arrived.missing, '5.000');
  assert.equal(arrived.day, '2031-08-05');
  assert.equal(arrived.note, 'Douane', 'et de qui, à qui la faute');

  const delivered = j.filter((e) => e.kind === 'delivered');
  assert.deepEqual(delivered.map((e) => e.quantity), ['10.000', '5.000'], 'remise en deux fois');
  assert.equal(delivered[0].weight_kg, '25.000', '10 sur 40 = 25 kg');
  assert.ok(delivered.every((e) => e.actor), 'et par qui');
  // Après la dernière remise : 15 confiés restent à Alger (35 arrivés − 15 remis = 20)…
  const last = delivered[1].after;
  assert.equal(last.delivered, '15.000');
  assert.equal(last.missing, '5.000');
  assert.equal(last.office, '20.000', '20 arrivés + 15 arrivés − 15 remis');

  await orders.cancelDelivery({ admin, id: x.o.id });
  d = await orders.getOrderDetail(x.o.id);
  const cancel = d.journal.find((e) => e.kind === 'delivery_cancelled');
  assert.equal(cancel.quantity, '15.000', 'la remise annulée rend les 15');
  assert.equal(cancel.after.delivered, '0.000');
  assert.equal(cancel.after.office, '35.000');

  // L'ordre est chronologique, et chaque ligne ne parle que d'elle-même.
  const times = d.journal.map((e) => e.at);
  assert.deepEqual([...times].sort(), times);
});

test('deux lignes du même ordre ne se mélangent pas dans le journal', async () => {
  const x = await setup([{ q: 10, w: 10 }, { q: 20, w: 40 }]);
  const [a, b] = x.lineIds;
  const p = await x.mkPassager('C');
  const bon = await bons.createBon({ admin, data: { passagerId: p.id, transportCurrency: 'DZD', lines: [
    { sourceLineId: a, measure: 'quantite', quantity: '10', unitPrice: '1' },
    { sourceLineId: b, measure: 'quantite', quantity: '20', unitPrice: '1' }] } });
  await bons.advanceStatus({ admin, id: bon.id });
  await bons.advanceStatus({ admin, id: bon.id });

  await orders.deliverOrder({ admin, id: x.o.id, lines: [{ lineId: b, quantity: '7' }] });
  const j = (await orders.getOrderDetail(x.o.id)).journal;
  assert.equal(j.filter((e) => e.kind === 'delivered').length, 1);
  assert.equal(String(j.find((e) => e.kind === 'delivered').line_id), String(b), 'la remise va à la ligne qui l’a reçue');
  assert.deepEqual(kinds(j, a), ['received', 'allocated', 'departed', 'arrived']);
  assert.deepEqual(kinds(j, b), ['received', 'allocated', 'departed', 'arrived', 'delivered']);
});

test('le journal d’un bon passager raconte son voyage, ses manquants et ses paiements', async () => {
  const x = await setup([{ q: 30, w: 60 }]);
  const p = await x.mkPassager('D');
  const bon = await carry(x, p, x.lineIds[0], 30, { departurePlannedOn: '2031-09-01', arrivalPromisedOn: '2031-09-04' });
  await bons.advanceStatus({ admin, id: bon.id, date: '2031-09-02' });
  await bons.advanceStatus({ admin, id: bon.id, date: '2031-09-06' });
  const l = (await bons.getBonDetail(bon.id)).lines[0];
  const r = await bons.reconcile({ admin, id: bon.id, lines: [{ lineId: l.id, missing: '4', responsible: 'Casse' }] });
  assert.deepEqual(kinds(r.journal), ['created', 'departed', 'arrived', 'missing']);

  const arrived = r.journal.find((e) => e.kind === 'arrived');
  assert.equal(arrived.day, '2031-09-06');
  assert.equal(arrived.promised, '2031-09-04');
  assert.equal(arrived.days_late, 2, 'promis le 4, arrivé le 6');
  assert.equal(arrived.quantity, '26.000');
  assert.equal(arrived.missing, '4.000');
  const missing = r.journal.find((e) => e.kind === 'missing');
  assert.equal(missing.quantity, '4.000');
  assert.equal(missing.note, 'Casse');
  assert.equal(r.journal[1].planned, '2031-09-01');

  // Un bon d'un ordre ne tient pas de journal de voyage : celui de l'ordre le fait.
  assert.deepEqual((await bons.getBonDetail(x.o.bons[0].id)).journal, []);
});
