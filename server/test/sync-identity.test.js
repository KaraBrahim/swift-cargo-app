// L'identité des comptes semés, vue par la réplication.
//
// Le défaut : la migration 026 posait un uuid FIXE sur le super-admin par un
// UPDATE. Mais server.js migre AVANT de semer — sur une base neuve la table est
// vide, l'UPDATE ne touche rien, et le seed insérait ensuite un uuid tiré au
// hasard. Le hub neuf (Render) et un poste déjà installé portaient donc deux
// uuid pour le même `username`.
//
// Conséquence, invisible tant qu'une seule machine tourne : à la première
// synchronisation, `sync_apply_row` fait ON CONFLICT (uuid), ne trouve rien,
// bascule sur l'INSERT et heurte l'unicité de `username`. Toute la transaction
// échoue — pas la ligne : le cycle entier, et tous les suivants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/testdb.js';
import { getPool, withTx } from '../src/db/pool.js';

const SUPERADMIN_UUID = '00000000-0000-4000-8000-000000000001';

let db;
before(async () => { db = await setupTestDb(); });
after(async () => { await db.stop(); });

test('le super-admin semé porte l’uuid convenu, pas un uuid au hasard', async () => {
  const { rows } = await getPool().query('SELECT uuid FROM admins WHERE username = $1', ['superadmin']);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].uuid, SUPERADMIN_UUID,
    'sans uuid fixe, la ligne du hub ne retrouve pas celle du poste et la synchronisation casse'
  );
});

test('la ligne du hub fusionne avec celle du poste au lieu de la heurter', async () => {
  // On rejoue ce que fait un poste qui reçoit le super-admin du hub : même
  // `username`, mot de passe différent, uuid convenu. Le résultat attendu est
  // UNE ligne, celle d'ici, dont le mot de passe est devenu celui du hub.
  const before = await getPool().query('SELECT id, uuid FROM admins WHERE username = $1', ['superadmin']);

  const snapshot = {
    ...(await getPool().query('SELECT * FROM admins WHERE username = $1', ['superadmin'])).rows[0],
    id: 1, // le hub numérote depuis 1 ; le poste doit garder SON id
    password_hash: '$2a$04$hubhubhubhubhubhubhubhubhubhubhubhubhubhubhubhubhubhubhu',
    origin_site: 'cloud',
  };

  await withTx(async (c) => {
    await c.query("SELECT set_config('app.sync_applying', 'on', true)");
    await c.query('SELECT sync_apply_row($1, $2, $3)', ['admins', snapshot, 'update']);
  });

  const after = await getPool().query('SELECT id, uuid, password_hash FROM admins WHERE username = $1', ['superadmin']);
  assert.equal(after.rows.length, 1, 'un second super-admin signifie que le compte unique s’est dédoublé');
  assert.equal(after.rows[0].id, before.rows[0].id, 'le poste garde son id local');
  assert.equal(after.rows[0].password_hash, snapshot.password_hash, 'le mot de passe du hub doit l’emporter');
});

test('un uuid divergent est exactement ce qui casse le cycle', async () => {
  // La preuve du défaut d'origine : avec l'ancien comportement (uuid au hasard
  // côté hub), c'est cette erreur-là que le poste rencontrait — et comme elle
  // remonte de la transaction, elle emportait tout le lot avec elle.
  const snapshot = {
    ...(await getPool().query('SELECT * FROM admins WHERE username = $1', ['superadmin'])).rows[0],
    id: 990001,
    uuid: '11111111-1111-4111-8111-111111111111', // l'uuid au hasard d'un hub neuf
  };

  await assert.rejects(
    withTx(async (c) => {
      await c.query("SELECT set_config('app.sync_applying', 'on', true)");
      await c.query('SELECT sync_apply_row($1, $2, $3)', ['admins', snapshot, 'update']);
    }),
    /unique|duplicate/i,
    'si ceci cesse d’échouer, c’est que `username` n’est plus unique — et le compte peut se dédoubler'
  );
});

// ── La purge des évènements orphelins (migration 027) ────────────────
//
// La 026 puis le seed ont réécrit l'uuid du super-admin. La ligne est réparée,
// mais le journal du hub garde les évènements d'AVANT, qui parlent d'un uuid que
// plus personne ne porte — et c'est sur eux que le poste se bloquait, à chaque
// cycle, sans jamais atteindre les bons évènements derrière.
//
// On exécute le vrai fichier de migration plutôt qu'une copie de sa requête :
// une copie finirait par diverger de ce qui tourne en production.
import { readFile } from 'node:fs/promises';

const PRUNE = new URL('../src/db/migrations/027_prune_orphan_admin_events.sql', import.meta.url);

async function outboxRow({ entityUuid, op = 'insert', username }) {
  const { rows } = await getPool().query(
    `INSERT INTO sync_outbox (uuid, entity, entity_uuid, op, snapshot, origin_site, server_seq)
     VALUES (gen_random_uuid(), 'admins', $1, $2, $3, 'cloud', nextval('sync_server_seq'))
     RETURNING id`,
    [entityUuid, op, JSON.stringify({ username, uuid: entityUuid })]
  );
  return rows[0].id;
}

const stillThere = async (id) =>
  (await getPool().query('SELECT 1 FROM sync_outbox WHERE id = $1', [id])).rows.length === 1;

test('027 efface l’évènement dont l’identité a été réécrite', async () => {
  // Exactement le cas du hub : uuid disparu, `username` toujours vivant ailleurs.
  const orphan = await outboxRow({ entityUuid: '22222222-2222-4222-8222-222222222222', username: 'superadmin' });

  await getPool().query(await readFile(PRUNE, 'utf8'));

  assert.equal(await stillThere(orphan), false, 'cet évènement ne peut que faire échouer le cycle');
});

test('027 ne touche ni aux évènements valides ni à ceux d’une ligne supprimée', async () => {
  const { rows: [su] } = await getPool().query('SELECT uuid FROM admins WHERE username = $1', ['superadmin']);

  // Valide : l'identité existe toujours.
  const live = await outboxRow({ entityUuid: su.uuid, username: 'superadmin' });
  // Ligne réellement supprimée : l'uuid ET le nom ont disparu. Ces évènements
  // DOIVENT être rejoués — sans eux, le poste garderait un compte que le hub a
  // supprimé. C'est ce que la condition sur `username` protège.
  const removed = await outboxRow({
    entityUuid: '33333333-3333-4333-8333-333333333333', username: 'employe-parti',
  });
  const removalDelete = await outboxRow({
    entityUuid: '33333333-3333-4333-8333-333333333333', op: 'delete', username: 'employe-parti',
  });

  await getPool().query(await readFile(PRUNE, 'utf8'));

  assert.ok(await stillThere(live), 'un évènement dont la ligne existe doit être servi');
  assert.ok(await stillThere(removed), 'une suppression réelle doit rester rejouable');
  assert.ok(await stillThere(removalDelete), 'la suppression elle-même doit rester rejouable');
});
