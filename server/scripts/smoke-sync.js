// 3-node offline-sync smoke: hub + China desk + Algeria desk, each on its own
// embedded Postgres. Create data on China (raw SQL, so the triggers fire) ->
// push to hub -> Algeria pulls + applies -> assert Algeria mirrors it exactly,
// with globally-unique ids and rebuilt projections.
import './testCredentials.js';
import pg from 'pg';
import { startEmbeddedPg } from '../src/db/embedded.js';
import { initPool, closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import * as sync from '../src/modules/sync/sync.service.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPS = ['fournisseurs','passagers','stock_categories','stock_items','stock_inventory','exchange_rates','orders','bons','bon_lines','bon_status_history','transactions','conversions','person_ledger','audit_log'];
const OFFSET = { china: 700000000, algeria: 1400000000 };

const nodes = {
  hub: { port: 55541, dir: join(__dirname, '..', '.sync-hub') },
  china: { port: 55542, dir: join(__dirname, '..', '.sync-china') },
  algeria: { port: 55543, dir: join(__dirname, '..', '.sync-algeria') },
};

const out = [];
const chk = (label, got, want) => out.push(`${String(got) === String(want) ? 'OK ' : 'XX '} ${label} = ${got} [attendu ${want}]`);

async function setup(name) {
  try { rmSync(nodes[name].dir, { recursive: true, force: true }); } catch {}
  const em = await startEmbeddedPg({ dataDir: nodes[name].dir, port: nodes[name].port, persistent: false });
  nodes[name].em = em;
  initPool(em.connectionString);
  await runMigrations();
  await runSeed();
  await closePool();
  const client = new pg.Client({ connectionString: em.connectionString, client_encoding: 'UTF8' });
  await client.connect();
  await client.query("SELECT set_config('app.site', $1, false)", [name]);
  if (OFFSET[name]) {
    for (const t of OPS) {
      await client.query(`SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST($2::bigint, (SELECT COALESCE(MAX(id),0)+1 FROM ${t})), false)`, [t, OFFSET[name]]);
    }
  }
  nodes[name].client = client;
}

try {
  for (const n of ['hub', 'china', 'algeria']) await setup(n);
  const china = nodes.china.client, hub = nodes.hub.client, algeria = nodes.algeria.client;

  // ── Create data on China (raw SQL → triggers capture into China outbox) ──
  const f = (await china.query("INSERT INTO fournisseurs (name, city) VALUES ('Fourn Chine','Yiwu') RETURNING id")).rows[0];
  chk('id fournisseur dans la plage Chine', f.id >= OFFSET.china, true);
  const o = (await china.query('INSERT INTO orders (fournisseur_id, created_by) VALUES ($1,1) RETURNING id, reference', [f.id])).rows[0];
  chk('référence bon fournisseur préfixée Chine', o.reference.startsWith('BF-CHN-'), true);
  const b = (await china.query("INSERT INTO bons (order_id, fournisseur_id, transport_currency, transport_fee, created_by) VALUES ($1,$2,'DZD','8000',1) RETURNING id, reference", [o.id, f.id])).rows[0];
  chk('référence bon passager préfixée Chine', b.reference.startsWith('BP-CHN-'), true);
  // China office caisse = id 1; deposit 5000 DZD
  await china.query("INSERT INTO transactions (caisse_id, currency_code, direction, amount, balance_after, type, admin_id) VALUES (1,'DZD','in','5000','5000','deposit',1)");
  // Fournisseur owes 8000 (receivable)
  await china.query("INSERT INTO person_ledger (person_type, person_id, currency_code, amount, balance_after, type, admin_id, ref_bon_id) VALUES ('fournisseur',$1,'DZD','-8000','-8000','transport_fee',1,$2)", [f.id, b.id]);
  await sync.recomputeProjections(china);

  const pending = (await china.query("SELECT COUNT(*)::int n FROM sync_outbox WHERE server_seq IS NULL AND origin_site='china'")).rows[0].n;
  chk('événements Chine en attente', pending, 5);

  // ── Push China → hub ──
  const events = await sync.collectOutbox(china, 'china');
  await hub.query('BEGIN');
  const acked = await sync.hubReceive(hub, events);
  await hub.query('COMMIT');
  await sync.markPushed(china, acked);
  chk('événements acquittés par le hub', Object.keys(acked).length, 5);

  // ── Algeria pulls from hub + applies ──
  const pulled = await sync.hubServe(hub, 0, 'algeria');
  chk('événements servis à Algérie', pulled.length, 5);
  await algeria.query('BEGIN');
  await sync.applyEvents(algeria, pulled);
  await algeria.query('COMMIT');

  // ── Assert Algeria mirrors China ──
  const af = (await algeria.query('SELECT name FROM fournisseurs WHERE id=$1', [f.id])).rows[0];
  chk('Algérie voit le fournisseur', af?.name, 'Fourn Chine');
  const ao = (await algeria.query('SELECT reference FROM orders WHERE id=$1', [o.id])).rows[0];
  chk('Algérie voit l\'ordre', ao?.reference, o.reference);
  const abCount = (await algeria.query('SELECT COUNT(*)::int n FROM bons WHERE order_id=$1', [o.id])).rows[0].n;
  chk('Algérie voit le bon', abCount, 1);
  const cb = (await algeria.query("SELECT balance FROM caisse_balances WHERE caisse_id=1 AND currency_code='DZD'")).rows[0];
  chk('solde caisse Chine recalculé chez Algérie', cb?.balance, '5000.00');
  const pb = (await algeria.query("SELECT balance FROM person_balances WHERE person_type='fournisseur' AND person_id=$1 AND currency_code='DZD'", [f.id])).rows[0];
  chk('solde fournisseur recalculé chez Algérie', pb?.balance, '-8000.00');
  const cur = (await algeria.query('SELECT last_server_seq FROM sync_cursor WHERE id=1')).rows[0];
  chk('curseur Algérie avancé', cur.last_server_seq, 5);

  // ── Idempotency: applying the same pull again changes nothing ──
  await algeria.query('BEGIN');
  await sync.applyEvents(algeria, pulled);
  await algeria.query('COMMIT');
  const dupF = (await algeria.query('SELECT COUNT(*)::int n FROM fournisseurs WHERE id=$1', [f.id])).rows[0].n;
  chk('ré-application idempotente (pas de doublon)', dupF, 1);

  console.log(out.join('\n'));
  console.log(out.every((l) => !l.startsWith('XX')) ? '\nSMOKE-SYNC PASSED' : '\nSMOKE-SYNC FAILED');
} catch (e) {
  console.error('SMOKE-SYNC ERROR:', e);
} finally {
  for (const n of ['hub', 'china', 'algeria']) {
    try { await nodes[n].client?.end(); } catch {}
    try { await nodes[n].em?.stop(); } catch {}
    try { rmSync(nodes[n].dir, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
}
