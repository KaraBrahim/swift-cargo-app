// La page Maintenance : ce qui part, ce qui reste.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, firstAdminAndCaisse } from '../helpers/testdb.js';
import { getPool } from '../../src/db/pool.js';
import * as m from '../../src/modules/maintenance/maintenance.service.js';

let db, admin;
before(async () => { db = await setupTestDb(); ({ admin } = await firstAdminAndCaisse()); admin.role = 'superadmin'; });
after(async () => { await db.stop(); });

const count = async (t) => Number((await getPool().query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);

test('le mot de confirmation est obligatoire', async () => {
  await assert.rejects(m.purge({ admin, domains: ['journal'], confirm: 'oui', ip: '::1' }), (e) => /SUPPRIMER/.test(JSON.stringify(e.details)));
});

test('« people » entraîne « activite », et les soldes repartent de zéro', async () => {
  await getPool().query("INSERT INTO people (name, is_passager) VALUES ('Test Purge', true)");
  const { purged } = await m.purge({ admin, domains: ['people'], confirm: 'SUPPRIMER', ip: '::1' });
  assert.deepEqual(new Set(purged), new Set(['people', 'activite']));
  assert.equal(await count('people'), 0);
  assert.equal(await count('bons'), 0);
  const { rows } = await getPool().query('SELECT count(*)::int AS n FROM caisse_balances WHERE balance <> 0');
  assert.equal(rows[0].n, 0);
});

test('la remise à zéro garde le super-admin, les devises et les caisses', async () => {
  await m.reset({ admin, confirm: 'SUPPRIMER', ip: '::1' });
  assert.equal(await count('admins'), 1, 'seul le super-admin');
  assert.equal(await count('currencies'), 5);
  // Les caisses sont de la structure, pas des données : elles restent, à zéro.
  const { rows: [off] } = await getPool().query("SELECT count(*)::int AS n FROM caisses WHERE kind = 'office' AND office IN ('china','algeria')");
  assert.equal(off.n, 2);
  assert.ok((await count('exchange_rates')) >= 5, 'les taux de départ sont recréés');
});

test('la sauvegarde ne contient aucun mot de passe', async () => {
  const b = await m.backup();
  assert.ok(b.tables.admins.length >= 1);
  assert.ok(b.tables.admins.every((a) => !('password_hash' in a)));
  assert.ok(!('sessions' in b.tables));
});

test('la remise à zéro passe même quand un compte supprimé est encore référencé', async () => {
  // Le cas vécu : un administrateur a modifié les paramètres et possède une
  // caisse personnelle. Ces tables survivent à la purge — la suppression de
  // son compte heurtait leurs clés étrangères, et l'écran disait « erreur interne ».
  const { rows: [a] } = await getPool().query(
    "INSERT INTO admins (username, full_name, password_hash, role, office) VALUES ('temp', 'Temp', 'x', 'admin', 'algeria') RETURNING id"
  );
  await getPool().query("INSERT INTO app_settings (key, value, updated_by) VALUES ('societe', '{}', $1) ON CONFLICT (key) DO UPDATE SET updated_by = $1", [a.id]);
  await getPool().query("INSERT INTO caisses (kind, label, owner_admin_id) VALUES ('admin', 'Caisse Temp', $1)", [a.id]);

  await m.reset({ admin, confirm: 'SUPPRIMER', ip: '::1' });

  assert.equal(await count('admins'), 1);
  const { rows: [c] } = await getPool().query("SELECT owner_admin_id FROM caisses WHERE label = 'Caisse Temp'");
  assert.equal(c.owner_admin_id, null, 'la caisse reste, sans propriétaire');
});
