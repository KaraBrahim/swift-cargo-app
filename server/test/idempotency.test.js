// La clé d'idempotence, vue depuis le middleware lui-même.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from './helpers/testdb.js';
import { idempotent } from '../src/middleware/idempotent.js';
import { getPool } from '../src/db/pool.js';

let db, admin;
let n = 0;
const uniqueKey = (label) => `idem-${label}-${process.pid}-${Date.now()}-${++n}`;

before(async () => {
  db = await setupTestDb();
  ({ admin } = await firstAdminAndCaisse());
});
after(async () => { await db.stop(); });

const makeReq = (key, body = { amount: '10' }) => ({
  method: 'POST',
  body,
  baseUrl: '/api',
  path: '/bons/1/reconcile',
  admin,
  get: (h) => (h.toLowerCase() === 'idempotency-key' ? key : undefined),
});

const makeRes = () => ({
  statusCode: 200,
  sent: undefined,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.sent = b; return b; },
});

// Résout dès que le middleware a tranché : soit il passe la main (`next`), soit
// il répond lui-même la réponse mémorisée.
function run(req, res) {
  return new Promise((resolve) => {
    const original = res.json.bind(res);
    res.json = (b) => { const out = original(b); resolve({ replay: true }); return out; };
    idempotent(req, res, (err) => resolve({ err }));
  });
}

// L'enregistrement de la réponse n'est pas attendu par le middleware (il répond
// d'abord). On attend qu'il ait atterri plutôt que de dormir un temps arbitraire.
async function stored(key, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const { rows } = await getPool().query('SELECT response FROM idempotency_keys WHERE key=$1', [key]);
    if (rows[0]?.response != null) return rows[0].response;
    if (Date.now() > until) throw new Error(`réponse jamais mémorisée pour ${key}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}


test('une requête rejouée retrouve sa réponse au lieu de refaire le travail', async () => {
  const key = uniqueKey('replay');

  const res1 = makeRes();
  assert.equal((await run(makeReq(key), res1)).err, undefined);
  res1.statusCode = 201;
  res1.json({ ok: true, montant: '10.00' });   // le handler répond
  await stored(key);

  // Nouvelle requête — un réessai après un timeout réseau — avec la même clé.
  const res2 = makeRes();
  const again = await run(makeReq(key), res2);
  assert.equal(again.replay, true, 'la seconde tentative ne doit jamais atteindre le handler');
  assert.deepEqual(res2.sent, { ok: true, montant: '10.00' });
  assert.equal(res2.statusCode, 201, 'et rend le statut d’origine');
  assert.equal(res2.headers['Idempotent-Replay'], 'true');
});

test('la même clé sur un autre corps est refusée', async () => {
  const key = uniqueKey('autre');

  const res1 = makeRes();
  await run(makeReq(key), res1);
  res1.statusCode = 201;
  res1.json({ ok: true });
  await stored(key);

  const conflict = await run(makeReq(key, { amount: '999999' }), makeRes());
  assert.equal(conflict.err?.code, 'CONFLICT');
  assert.match(conflict.err.message, /autre opération/i);
});

test('une opération qui échoue libère sa clé, pour qu’on puisse la retenter', async () => {
  const key = uniqueKey('echec');

  const res1 = makeRes();
  assert.equal((await run(makeReq(key), res1)).err, undefined);
  res1.statusCode = 409;                        // le handler refuse
  res1.json({ error: { code: 'CONFLICT' } });

  // La clé disparaît : un refus n'est pas un résultat à rejouer, et l'utilisateur
  // doit pouvoir corriger sa saisie et réessayer.
  const until = Date.now() + 3000;
  let rows;
  do {
    ({ rows } = await getPool().query('SELECT 1 FROM idempotency_keys WHERE key=$1', [key]));
    if (!rows.length) break;
    await new Promise((r) => setTimeout(r, 25));
  } while (Date.now() < until);
  assert.equal(rows.length, 0, 'la clé d’une opération échouée doit être libérée');

  const retry = await run(makeReq(key), makeRes());
  assert.equal(retry.err, undefined, 'et le réessai repart pour de bon');
});

test('sans en-tête, rien ne change', async () => {
  const req = { ...makeReq('peu-importe'), get: () => undefined };
  const res = makeRes();
  assert.equal((await run(req, res)).err, undefined);
});
