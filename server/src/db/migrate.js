// Simple forward-only migration runner. Applies each *.sql in migrations/ once,
// in filename order, recording it in schema_migrations. Each file runs inside a
// transaction, so a failing migration leaves the DB untouched.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, withTx } from './pool.js';
import { logger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export async function runMigrations() {
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename    TEXT PRIMARY KEY,
       applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await getPool().query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withTx(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
    logger.info(`Migration applied: ${file}`);
    count++;
  }
  if (count === 0) logger.info('Migrations: already up to date.');
  return count;
}

// CLI: `npm run migrate`
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  const { ensureConnection } = await import('./connect.js');
  const conn = await ensureConnection();
  try {
    await runMigrations();
  } finally {
    const { closePool } = await import('./pool.js');
    await closePool();
    await conn.stop();
  }
  process.exit(0);
}
