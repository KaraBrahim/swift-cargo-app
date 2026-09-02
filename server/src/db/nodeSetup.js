// Sets each operational table's id sequence into this node's globally-unique
// range, so two offline nodes never mint colliding integer PKs. Idempotent:
// only ever advances a sequence, never rewinds.
import { getPool } from './pool.js';
import { config, ID_OFFSETS } from '../config.js';
import { logger } from '../lib/logger.js';

const OPERATIONAL = [
  'fournisseurs', 'passagers', 'stock_categories', 'stock_items', 'stock_inventory',
  'exchange_rates', 'orders', 'bons', 'bon_lines', 'bon_status_history',
  'transactions', 'conversions', 'person_ledger', 'audit_log', 'office_transfers',
];

export async function applyIdRanges() {
  const offset = ID_OFFSETS[config.site] ?? 1;
  const pool = getPool();
  for (const table of OPERATIONAL) {
    await pool.query(
      `SELECT setval(
         pg_get_serial_sequence($1, 'id'),
         GREATEST($2::bigint, (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table})),
         false)`,
      [table, offset]
    );
  }
  logger.info(`Id ranges set for site '${config.site}' (offset ${offset}).`);
}
