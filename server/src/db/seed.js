// Idempotent seed. Safe to run repeatedly.
//
// What it creates depends on where it runs:
//   everywhere   - the currencies, their starting rates, the two OFFICE caisses
//                  (China + Algeria) and the SUPER-ADMIN account;
//   dev/test only - admin1..admin4.
//
// The structural rows are not demo data: every bon, transaction and balance
// references a currency by foreign key, and the money actions post into the two
// office caisses. Remove them and the app does not run.
//
// The super-admin cannot be removed either: a fresh database has no users, and
// creating one requires being logged in as a super-admin, so seeding nobody
// locks the app permanently. It is the single account production is given; the
// real staff are then created from Utilisateurs, under their real names, so the
// audit trail reads "Karim" and not "Admin Chine 1" beside every cash movement.
import bcrypt from 'bcryptjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPool, withTx } from './pool.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const ADMINS = [
  { username: 'admin1', full_name: 'Admin Chine 1', office: 'china', role: 'admin' },
  { username: 'admin2', full_name: 'Admin Chine 2', office: 'china', role: 'admin' },
  { username: 'admin3', full_name: 'Admin Algérie 1', office: 'algeria', role: 'admin' },
  { username: 'admin4', full_name: 'Admin Algérie 2', office: 'algeria', role: 'admin' },
];

const CURRENCIES = [
  { code: 'DZD', name: 'Dinar algérien', symbol: 'DA', is_base: true, sort_order: 0 },
  { code: 'CNY', name: 'Yuan chinois', symbol: '¥', is_base: false, sort_order: 1 },
  { code: 'ALP', name: 'Ali Pay (Chine)', symbol: 'Alipay', is_base: false, sort_order: 2 },
  { code: 'USD', name: 'Dollar américain', symbol: '$', is_base: false, sort_order: 3 },
  { code: 'EUR', name: 'Euro', symbol: '€', is_base: false, sort_order: 4 },
];

const INITIAL_RATES = { DZD: '1', CNY: '30.00000000', ALP: '30.00000000', USD: '255.00000000', EUR: '270.00000000' };

// Les comptes semés portent le MÊME uuid sur toutes les machines.
//
// La migration 026 le faisait déjà — mais par un UPDATE, et sur une base neuve
// les migrations tournent AVANT le seed (server.js) : la table est vide,
// l'UPDATE ne touche aucune ligne, et le seed insère ensuite un uuid tiré au
// hasard (DEFAULT gen_random_uuid, migration 004). Un hub neuf et un poste déjà
// installé se retrouvaient donc avec DEUX uuid pour le même `username`.
//
// Ce que cela donne à la première synchronisation : le hub pousse sa ligne,
// `sync_apply_row` tente ON CONFLICT (uuid) — qui ne trouve rien — donc un
// INSERT, qui heurte l'unicité de `username`. La transaction entière échoue.
// Pas une ligne perdue : TOUT le cycle, et à chaque cycle suivant, pour
// toujours. C'est précisément l'accident que la 026 voulait éviter, et que
// l'ordre migrations-puis-seed lui reprenait.
//
// On pose donc l'uuid à l'INSERT, et on le ramène sur les lignes déjà créées.
// Les deux côtés convergent au démarrage suivant, quel que soit leur passé.
const SEED_UUID = {
  superadmin: '00000000-0000-4000-8000-000000000001', // identique à la 026
  admin1: '00000000-0000-4000-8000-000000000002',
  admin2: '00000000-0000-4000-8000-000000000003',
  admin3: '00000000-0000-4000-8000-000000000004',
  admin4: '00000000-0000-4000-8000-000000000005',
};

const OFFICES = [
  { office: 'china', label: 'Caisse Chine' },
  { office: 'algeria', label: 'Caisse Algérie' },
];

export async function runSeed() {
  const pool = getPool();

  for (const c of CURRENCIES) {
    await pool.query(
      `INSERT INTO currencies (code, name, symbol, is_base, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, symbol = EXCLUDED.symbol,
             is_base = EXCLUDED.is_base, sort_order = EXCLUDED.sort_order`,
      [c.code, c.name, c.symbol, c.is_base, c.sort_order]
    );
  }

  // Les taux d'amorçage ne se répliquent pas.
  //
  // Chaque machine crée les siens au premier démarrage : ce sont les mêmes cinq
  // valeurs partout, et les diffuser n'apprend rien à personne. Les échanger
  // faisait en revanche du dégât — cinq lignes identiques par machine, et
  // surtout une collision : `exchange_rates` est une table répliquée, donc le
  // poste poussait ses taux d'amorçage vers le hub, qui avait déjà les siens.
  //
  // Les VRAIS taux, ceux qu'une personne saisit, passent par l'application et
  // se répliquent normalement. Seul l'amorçage est tu, comme l'est déjà le
  // super-admin d'un poste.
  await withTx(async (client) => {
    await client.query("SELECT set_config('app.sync_applying', 'on', true)");
    for (const [code, rate] of Object.entries(INITIAL_RATES)) {
      const { rows } = await client.query('SELECT 1 FROM exchange_rates WHERE currency_code = $1 LIMIT 1', [code]);
      if (rows.length === 0) {
        await client.query(`INSERT INTO exchange_rates (currency_code, dzd_per_unit, note) VALUES ($1,$2,'seed')`, [code, rate]);
      }
    }
  });

  // Without this the super-admin would be created with an empty password — and
  // it is the only account, so the whole app would hang on an unusable login.
  if (!config.superadminPassword) {
    throw new Error(
      "SUPERADMIN_PASSWORD est vide : impossible de créer le compte super-admin, et sans lui " +
      'personne ne peut se connecter. En développement, copiez server/.env.example vers server/.env.'
    );
  }
  const superHash = await bcrypt.hash(config.superadminPassword, config.bcryptRounds);
  const SEED_USERS = [
    { username: 'superadmin', full_name: 'Super Administrateur', office: null, role: 'superadmin', hash: superHash },
  ];

  // Development scaffolding only. Keeping these outside production is what lets
  // `npm test` and the smoke scripts log in as admin1 without a .env.
  if (!config.isProduction && config.seedAdminPassword) {
    const adminHash = await bcrypt.hash(config.seedAdminPassword, config.bcryptRounds);
    SEED_USERS.push(...ADMINS.map((a) => ({ ...a, hash: adminHash })));
  }
  // Les comptes se répliquent depuis la migration 026. Or CHAQUE machine sème
  // son propre super-admin au premier démarrage, avec un mot de passe qui lui
  // est propre : si un poste poussait le sien, il écraserait celui du hub — et
  // le compte unique redeviendrait trois comptes qui se battent.
  //
  // Le hub sème et diffuse ; un poste sème pour lui-même, en silence. C'est à
  // cela que sert `app.sync_applying` : le déclencheur de capture le lit et
  // n'enregistre rien. Le poste démarre donc utilisable seul, et adopte le
  // compte du hub dès la première synchronisation.
  await withTx(async (client) => {
    if (config.site !== 'cloud') {
      await client.query("SELECT set_config('app.sync_applying', 'on', true)");
    }
    for (const a of SEED_USERS) {
      // Le mot de passe n'est posé qu'à la création ; le nom, le bureau, le rôle
      // et l'uuid (voir SEED_UUID) sont maintenus. Ne pas toucher au mot de
      // passe est ce qui permet au poste de garder celui qu'il a adopté du hub.
      await client.query(
        `INSERT INTO admins (uuid, username, full_name, password_hash, office, role) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, office = EXCLUDED.office,
           role = EXCLUDED.role, uuid = EXCLUDED.uuid`,
        [SEED_UUID[a.username], a.username, a.full_name, a.hash, a.office, a.role]
      );
    }
  });

  // Two office caisses (+ a balance row per currency).
  for (const o of OFFICES) {
    await withTx(async (client) => {
      const found = await client.query("SELECT id FROM caisses WHERE kind='office' AND office=$1", [o.office]);
      let caisseId = found.rows[0]?.id;
      if (!caisseId) {
        const ins = await client.query(
          `INSERT INTO caisses (kind, office, label) VALUES ('office',$1,$2) RETURNING id`,
          [o.office, o.label]
        );
        caisseId = ins.rows[0].id;
      } else {
        // Keep the label in sync with the seed (e.g. after a rename).
        await client.query('UPDATE caisses SET label=$2 WHERE id=$1', [caisseId, o.label]);
      }
      await client.query(
        `INSERT INTO caisse_balances (caisse_id, currency_code)
           SELECT $1, code FROM currencies
         ON CONFLICT (caisse_id, currency_code) DO NOTHING`,
        [caisseId]
      );
    });
  }

  // Report what was actually created, not what the environment implies: a
  // development machine with SEED_ADMIN_PASSWORD blank has no demo accounts
  // either, and a log line that says otherwise is worse than none.
  const demo = SEED_USERS.length - 1;
  logger.info(
    demo > 0
      ? `Seed complete (super-admin + ${demo} comptes de démonstration).`
      : 'Seed complete (super-admin uniquement — aucun compte de démonstration).'
  );
}

// CLI: `npm run seed`
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  const { ensureConnection } = await import('./connect.js');
  const conn = await ensureConnection();
  try {
    await runSeed();
  } finally {
    const { closePool } = await import('./pool.js');
    await closePool();
    await conn.stop();
  }
  process.exit(0);
}
