import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;
let pool = null;

export function initPool(connectionString) {
  if (pool) return pool;
  // Force UTF-8 on every session — the server locale may default to WIN1252.
  pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, client_encoding: 'UTF8' });
  pool.on('error', (err) => logger.error('Idle pg client error', err.message));
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('DB pool not initialised — call initPool() first.');
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

// Run `fn(client)` inside a single BEGIN/COMMIT transaction. Rolls back on any
// throw. This is the ONLY way caisse mutations touch the database.
export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('ROLLBACK failed', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
