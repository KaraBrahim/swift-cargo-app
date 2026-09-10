// Les routes noeud-a-noeud du hub, exercees a travers la VRAIE pile Express.
//
// Le defaut qu'il verrouille : tous les routeurs sont montes sur '/api' et
// dix-sept d'entre eux appellent `router.use(requireAuth)`, qui s'execute pour
// toute requete TRAVERSANT le routeur. syncRouter etait monte apres eux, donc
// GET /api/sync/pull recevait « Authentification requise » du requireAuth de
// `rates` sans jamais atteindre `requireNode`. Le hub refusait un poste qui
// presentait pourtant le bon jeton, et la synchronisation entre machines ne
// pouvait pas demarrer.
//
// Aucun test ne pouvait le voir : les autres appellent les services et les
// middlewares directement. Celui-ci passe par le serveur HTTP, seul endroit ou
// l'ordre de montage existe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setupTestDb } from './helpers/testdb.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

let db, server, base;
const previousToken = config.nodeToken;

before(async () => {
  db = await setupTestDb();
  // Le hub de production en definit un ; sans lui `requireNode` laisse passer
  // en developpement et le test ne prouverait rien.
  config.nodeToken = 'test-node-token';
  server = createServer(createApp());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  config.nodeToken = previousToken;
  server.close();
  await once(server, 'close');
  await db.stop();
});

test('pull: le bon jeton de noeud est servi, pas renvoye a la connexion', async () => {
  const res = await fetch(`${base}/api/sync/pull?since=0&limit=1`, {
    headers: { 'x-node-token': 'test-node-token' },
  });
  assert.equal(res.status, 200, "le hub doit servir /sync/pull a un noeud authentifie");
  assert.ok(Array.isArray((await res.json()).events));
});

test('pull: sans jeton, le refus vient de requireNode', async () => {
  const res = await fetch(`${base}/api/sync/pull?since=0`);
  assert.equal(res.status, 401);
  // Le message distingue les deux causes : celui de requireAuth
  // (« Authentification requise ») signalerait le retour du defaut.
  assert.match((await res.json()).error.message, /jeton/i);
});

test('push: accepte un lot vide et acquitte', async () => {
  const res = await fetch(`${base}/api/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-node-token': 'test-node-token' },
    body: JSON.stringify({ site: 'china', events: [] }),
  });
  assert.equal(res.status, 200);
  // `acked` associe chaque uuid reçu à son server_seq ; un lot vide n'acquitte rien.
  assert.deepEqual((await res.json()).acked, {});
});

test('les routes de l\u2019interface restent protegees par requireAuth', async () => {
  // Un jeton de noeud n'est pas une session : il ne doit ouvrir que push/pull.
  for (const path of ['/api/sync/status', '/api/sync/run']) {
    const res = await fetch(`${base}${path}`, {
      method: path.endsWith('/run') ? 'POST' : 'GET',
      headers: { 'x-node-token': 'test-node-token' },
    });
    assert.equal(res.status, 401, `${path} doit exiger une session`);
  }
});
