import { ensureConnection } from '../../src/db/connect.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runSeed } from '../../src/db/seed.js';

// Connects via DATABASE_URL (set by scripts/run-tests.js) or, as a fallback,
// an embedded instance. Migrates + seeds a clean database.
// `node --test` lance chaque fichier dans SON processus, en parallèle, contre la
// même base : sans verrou, deux d'entre eux migrent et sèment en même temps.
// runMigrations() prend déjà le sien ; le seed prend celui-ci.
const SEED_LOCK = 776_401_002;

export async function setupTestDb() {
  const conn = await ensureConnection();
  await runMigrations();
  const seedLock = await getPool().connect();
  try {
    await seedLock.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    await runSeed();
  } finally {
    await seedLock.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]).catch(() => {});
    seedLock.release();
  }
  return {
    stop: async () => {
      await closePool();
      await conn.stop(); // no-op when DATABASE_URL is external
    },
  };
}

export async function firstAdminAndCaisse() {
  const { rows: admins } = await getPool().query('SELECT id FROM admins ORDER BY id LIMIT 1');
  const admin = { id: admins[0].id };
  // Two office caisses (china, algeria) — use them as the two test caisses.
  const { rows: caisses } = await getPool().query("SELECT id FROM caisses WHERE kind='office' ORDER BY office");
  return { admin, caisseId: caisses[0].id, globalCaisseId: caisses[1].id };
}

export async function balanceOf(caisseId, currency) {
  const { rows } = await getPool().query(
    'SELECT balance FROM caisse_balances WHERE caisse_id=$1 AND currency_code=$2', [caisseId, currency]
  );
  return rows[0]?.balance ?? null;
}

// Une caisse À PART au bureau d'Algérie, pour les tests qui encaissent un
// fournisseur (qui ne paie qu'en Algérie). L'index `uniq_office_caisse` n'en
// autorise qu'une par bureau parmi les caisses « office », et `uniq_global_caisse`
// une seule globale : on passe donc par une caisse d'administrateur, dont le
// propriétaire est un compte créé pour l'occasion. Chaque fichier de test a ainsi
// la sienne, et les soldes qu'il vérifie ne bougent pas sous un autre fichier.
export async function algeriaTestCaisse(label) {
  const db = getPool();
  const username = `test_alger_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const { rows: [a] } = await db.query(
    `INSERT INTO admins (username, full_name, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [username, label]
  );
  const { rows: [c] } = await db.query(
    `INSERT INTO caisses (kind, owner_admin_id, office, label) VALUES ('admin', $1, 'algeria', $2) RETURNING id`,
    [a.id, label]
  );
  return c.id;
}
