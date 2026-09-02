import { ensureConnection } from '../../src/db/connect.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runSeed } from '../../src/db/seed.js';

// Connects via DATABASE_URL (set by scripts/run-tests.js) or, as a fallback,
// an embedded instance. Migrates + seeds a clean database.
export async function setupTestDb() {
  const conn = await ensureConnection();
  await runMigrations();
  await runSeed();
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
