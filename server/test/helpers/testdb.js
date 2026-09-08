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
