// Starts a real, local PostgreSQL with no system install (downloads a binary on
// first run). Used only in development / tests when no DATABASE_URL is provided.
// The app database is created as UTF-8 (the initdb default on Windows is WIN1252,
// which cannot store Arabic / Chinese / € / ¥ — unacceptable for this app).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

const DB_NAME = 'swiftcargo';

async function ensureUtf8Database(port) {
  const admin = new pg.Client({
    host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'postgres',
    client_encoding: 'UTF8',
  });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (rows.length === 0) {
      await admin.query(
        `CREATE DATABASE ${DB_NAME}
           WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`
      );
      logger.info(`Created UTF-8 database "${DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

// Is this process id actually running right now?
// `kill(pid, 0)` sends no signal — it only asks. ESRCH means "no such process";
// EPERM means it exists but belongs to someone else, which still counts as
// alive.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Postgres refuses to start while postmaster.pid exists, and it is left behind
// by anything that kills the process rather than asking it to stop: a force
// quit, a power cut, closing the terminal window. The database is fine — only
// the note on the door is stale — but the app then refuses to start for good,
// with a message that names a file most people have never heard of.
//
// So: read the pid in that file. If it is genuinely running, say so in words
// someone can act on. If it is not, the lock is stale — remove it and carry on.
function clearStaleLock(dataDir) {
  const lock = join(dataDir, 'postmaster.pid');
  if (!existsSync(lock)) return;

  const pid = Number(String(readFileSync(lock, 'utf8')).split(/\r?\n/)[0].trim());
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) {
    const err = new Error(
      `Une autre instance de Swift Cargo utilise déjà cette base de données (PID ${pid}). ` +
        "N'en lancez qu'une seule : ouvrez http://localhost:4000, ou arrêtez l'autre " +
        `d'abord (Windows : taskkill /PID ${pid} /F).`
    );
    // Nothing is broken and there is nothing to debug — the message IS the fix.
    err.userFacing = true;
    throw err;
  }

  rmSync(lock, { force: true });
  logger.warn(
    'Verrou Postgres périmé supprimé — le serveur précédent ne s’est pas arrêté proprement. ' +
      'Les données sont intactes : Postgres rejoue son journal au démarrage.'
  );
}

export async function startEmbeddedPg({ dataDir, port, persistent = true }) {
  clearStaleLock(dataDir);

  const pgInst = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent,
  });

  const alreadyInitialised = existsSync(join(dataDir, 'PG_VERSION'));
  if (!alreadyInitialised) {
    logger.info('Embedded Postgres: initialising data directory…');
    await pgInst.initialise();
  }
  await pgInst.start();
  await ensureUtf8Database(port);

  const connectionString = `postgres://postgres:postgres@localhost:${port}/${DB_NAME}`;
  logger.info(`Embedded Postgres ready on port ${port}`);
  return {
    connectionString,
    stop: async () => {
      try {
        await pgInst.stop();
      } catch (e) {
        logger.warn('Embedded Postgres stop error', e.message);
      }
    },
  };
}
