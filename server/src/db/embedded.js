// Starts a real, local PostgreSQL with no system install (downloads a binary on
// first run). Used only in development / tests when no DATABASE_URL is provided.
// The app database is created as UTF-8 (the initdb default on Windows is WIN1252,
// which cannot store Arabic / Chinese / € / ¥ — unacceptable for this app).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { existsSync } from 'node:fs';
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

export async function startEmbeddedPg({ dataDir, port, persistent = true }) {
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
