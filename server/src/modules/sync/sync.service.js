// Offline sync engine. Star topology: desks push their outbox to the hub and
// pull+apply the hub's ordered feed. Idempotent by uuid; the hub stamps a
// monotonic server_seq that gives every node the same total order. Balances are
// rebuilt from the event logs after applying (projections, never synced).
import { getPool, withTx } from '../../db/pool.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

const serialize = (r) => ({
  uuid: r.uuid, entity: r.entity, entity_uuid: r.entity_uuid,
  op: r.op, snapshot: r.snapshot, origin_site: r.origin_site, server_seq: r.server_seq,
});

// ── Desk: outbox ─────────────────────────────────────────────────────
// A batch, not the whole backlog. The hub caps a request body at 256 KB; a desk
// that has been offline for a week builds an outbox far past that, and an
// unbounded push then fails on every single cycle — the events never leave, and
// the failure looks like a network problem rather than a size one. Pushing in
// slices makes a long backlog drain instead of jam.
export const OUTBOX_BATCH = 200;

export async function collectOutbox(db = getPool(), site = config.site, limit = OUTBOX_BATCH) {
  const { rows } = await db.query(
    'SELECT * FROM sync_outbox WHERE server_seq IS NULL AND origin_site = $1 ORDER BY id LIMIT $2',
    [site, limit]
  );
  return rows.map(serialize);
}

export async function markPushed(db, ack) {
  for (const [uuid, seq] of Object.entries(ack)) {
    await db.query('UPDATE sync_outbox SET server_seq = $2 WHERE uuid = $1', [uuid, seq]);
  }
}

// ── Hub: accept pushed events (assign server_seq, apply, store) ───────
// Runs inside a transaction (client passed by the route/test).
export async function hubReceive(client, events) {
  const ack = {};
  for (const e of events) {
    const seen = await client.query('SELECT server_seq FROM sync_outbox WHERE uuid = $1', [e.uuid]);
    if (seen.rows.length) { ack[e.uuid] = Number(seen.rows[0].server_seq); continue; }

    await client.query("SELECT set_config('app.sync_applying', 'on', true)");
    await client.query('SELECT sync_apply_row($1, $2, $3)', [e.entity, e.snapshot, e.op]);
    await client.query("SELECT set_config('app.sync_applying', 'off', true)");

    const { rows } = await client.query("SELECT nextval('sync_server_seq') AS s");
    const seq = Number(rows[0].s);
    await client.query(
      `INSERT INTO sync_outbox (uuid, entity, entity_uuid, op, snapshot, origin_site, server_seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.uuid, e.entity, e.entity_uuid, e.op, e.snapshot, e.origin_site, seq]
    );
    ack[e.uuid] = seq;
  }
  await recomputeProjections(client);
  return ack;
}

// Give the hub's OWN locally-created changes a server_seq (in id order) so they
// propagate to desks too.
export async function hubStampLocal(db = getPool()) {
  const { rows } = await db.query('SELECT id FROM sync_outbox WHERE server_seq IS NULL ORDER BY id');
  for (const r of rows) {
    await db.query("UPDATE sync_outbox SET server_seq = nextval('sync_server_seq') WHERE id = $1", [r.id]);
  }
}

// ── Hub: serve events after a cursor ─────────────────────────────────
export async function hubServe(db = getPool(), since = 0, excludeOrigin = null, limit = 500) {
  const params = [since, limit];
  let ex = '';
  if (excludeOrigin) { params.push(excludeOrigin); ex = `AND origin_site <> $3`; }
  const { rows } = await db.query(
    `SELECT uuid, entity, entity_uuid, op, snapshot, origin_site, server_seq
       FROM sync_outbox
      WHERE server_seq IS NOT NULL AND server_seq > $1 ${ex}
      ORDER BY server_seq LIMIT $2`,
    params
  );
  return rows.map(serialize);
}

// ── Desk: apply pulled events, then rebuild projections + advance cursor ─
export async function applyEvents(client, events) {
  if (!events.length) return 0;
  await client.query("SELECT set_config('app.sync_applying', 'on', true)");
  let maxSeq = 0;
  for (const e of events) {
    const seen = await client.query('SELECT 1 FROM sync_outbox WHERE uuid = $1', [e.uuid]);
    if (!seen.rows.length) {
      await client.query('SELECT sync_apply_row($1, $2, $3)', [e.entity, e.snapshot, e.op]);
      await client.query(
        `INSERT INTO sync_outbox (uuid, entity, entity_uuid, op, snapshot, origin_site, server_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [e.uuid, e.entity, e.entity_uuid, e.op, e.snapshot, e.origin_site, e.server_seq]
      );
    }
    if (Number(e.server_seq) > maxSeq) maxSeq = Number(e.server_seq);
  }
  await client.query("SELECT set_config('app.sync_applying', 'off', true)");
  await recomputeProjections(client);
  if (maxSeq) {
    await client.query('UPDATE sync_cursor SET last_server_seq = GREATEST(last_server_seq, $1) WHERE id = 1', [maxSeq]);
  }
  return events.length;
}

// Rebuild the two projection tables from their append-only event logs.
export async function recomputeProjections(db) {
  // Lock every projection row this is about to rewrite, BEFORE reading the
  // event logs. Without it a deposit committing between the SUM and the UPDATE
  // is overwritten out of existence — the movement stays in `transactions`, the
  // balance no longer counts it, and nothing says so. Ordered, so this can
  // never deadlock against another copy of itself.
  await db.query('SELECT 1 FROM caisse_balances ORDER BY caisse_id, currency_code FOR UPDATE');
  await db.query('SELECT 1 FROM person_balances ORDER BY person_type, person_id, currency_code FOR UPDATE');
  await db.query(
    `INSERT INTO caisse_balances (caisse_id, currency_code, balance)
       SELECT t.caisse_id, t.currency_code,
              SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
         FROM transactions t
         LEFT JOIN caisse_balances cb ON cb.caisse_id=t.caisse_id AND cb.currency_code=t.currency_code
        WHERE cb.caisse_id IS NULL
        GROUP BY t.caisse_id, t.currency_code`
  );
  await db.query(
    `UPDATE caisse_balances cb SET balance = COALESCE((
        SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
          FROM transactions t WHERE t.caisse_id=cb.caisse_id AND t.currency_code=cb.currency_code
      ), 0)`
  );
  await db.query(
    `INSERT INTO person_balances (person_type, person_id, currency_code, balance)
       SELECT pl.person_type, pl.person_id, pl.currency_code, SUM(pl.amount)
         FROM person_ledger pl
         LEFT JOIN person_balances pb ON pb.person_type=pl.person_type AND pb.person_id=pl.person_id AND pb.currency_code=pl.currency_code
        WHERE pb.person_type IS NULL
        GROUP BY pl.person_type, pl.person_id, pl.currency_code`
  );
  await db.query(
    `UPDATE person_balances pb SET balance = COALESCE((
        SELECT SUM(pl.amount) FROM person_ledger pl
         WHERE pl.person_type=pb.person_type AND pl.person_id=pb.person_id AND pl.currency_code=pb.currency_code
      ), 0)`
  );
}

// ── Status ───────────────────────────────────────────────────────────
// Outcome of the most recent cycle. In-memory on purpose: it describes THIS
// process's connectivity, so it should reset when the node restarts.
const lastCycle = { at: null, ok: null, error: null, pushed: 0, pulled: 0 };

export async function getStatus(db = getPool()) {
  const isHub = config.site === 'cloud' || !config.cloudUrl;
  const [{ rows: pend }, { rows: cur }] = await Promise.all([
    // oldest_at turns "3 en attente" into "3 en attente depuis 2 h" — the number
    // that actually tells a cashier something is wrong.
    db.query(
      `SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest_at
         FROM sync_outbox WHERE server_seq IS NULL AND origin_site = $1`,
      [config.site]
    ),
    db.query('SELECT last_server_seq FROM sync_cursor WHERE id = 1'),
  ]);
  return {
    site: config.site,
    isHub,
    pending: pend[0].n,
    oldestPendingAt: pend[0].oldest_at,
    lastServerSeq: Number(cur[0]?.last_server_seq ?? 0),
    // The hub has nothing to reach, so it is never "offline".
    online: isHub ? true : lastCycle.ok,
    lastSyncAt: lastCycle.at,
    lastError: lastCycle.error,
    intervalMs: config.syncIntervalMs,
  };
}

// ── Desk worker: one push+pull cycle against the hub ─────────────────
export async function runSync() {
  if (config.site === 'cloud' || !config.cloudUrl) return { skipped: true };
  const pool = getPool();
  const headers = { 'content-type': 'application/json', ...(config.nodeToken ? { 'x-node-token': config.nodeToken } : {}) };

  try {
    // push
    const outbox = await collectOutbox(pool, config.site);
    if (outbox.length) {
      const res = await fetch(`${config.cloudUrl}/api/sync/push`, {
        method: 'POST', headers, body: JSON.stringify({ site: config.site, events: outbox }),
      });
      if (!res.ok) throw new Error(`push failed ${res.status}`);
      const { acked } = await res.json();
      await markPushed(pool, acked);
    }

    // pull
    const { rows: cur } = await pool.query('SELECT last_server_seq FROM sync_cursor WHERE id = 1');
    const since = Number(cur[0]?.last_server_seq ?? 0);
    const res = await fetch(`${config.cloudUrl}/api/sync/pull?since=${since}&excludeOrigin=${config.site}`, { headers });
    if (!res.ok) throw new Error(`pull failed ${res.status}`);
    const { events } = await res.json();
    if (events.length) await withTx((c) => applyEvents(c, events));

    Object.assign(lastCycle, {
      at: new Date().toISOString(), ok: true, error: null,
      pushed: outbox.length, pulled: events.length,
    });
    return { pushed: outbox.length, pulled: events.length };
  } catch (err) {
    // Record the failure for the UI, then rethrow so callers still see it.
    Object.assign(lastCycle, { at: new Date().toISOString(), ok: false, error: err.message });
    throw err;
  }
}

// ── L'ordonnancement : rapide en ligne, patient hors ligne ───────────
//
// Un `setInterval` fixe ne pouvait pas faire les deux. À 15 secondes, un bon
// saisi en Chine mettait un quart de minute à apparaître à Alger ; à 3 secondes,
// un poste débranché une journée aurait tenté 28 000 fois et rempli son journal.
//
// Donc : un délai qui s'adapte. Court quand ça passe, doublé à chaque échec
// jusqu'à un plafond, et remis au court dès le premier succès. Et surtout, une
// écriture locale ne l'attend pas — elle réveille le cycle tout de suite.
let timer = null;
let running = false;
let delay = 0;
let pending = false;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(cycle, ms);
}

async function cycle() {
  if (running) { pending = true; return; }
  running = true;
  try {
    await runSync();
    delay = config.syncIntervalMs;
  } catch (e) {
    // Hors ligne est un état NORMAL ici, pas une panne : au niveau debug, sinon
    // le journal d'un poste en déplacement n'est plus lisible.
    logger.debug?.('Sync cycle skipped', e.message);
    delay = Math.min(Math.max(delay * 2, config.syncIntervalMs), config.syncMaxBackoffMs);
  } finally {
    running = false;
    // Une écriture arrivée pendant le cycle n'attend pas le tour suivant.
    if (pending) { pending = false; schedule(0); } else schedule(delay);
  }
}

export function startSyncWorker() {
  if (config.site === 'cloud' || !config.cloudUrl || timer) return;
  logger.info(
    `Sync worker: site '${config.site}' -> ${config.cloudUrl} `
    + `(${config.syncIntervalMs}ms, jusqu'à ${config.syncMaxBackoffMs}ms hors ligne)`
  );
  delay = config.syncIntervalMs;
  schedule(0);
}

export function stopSyncWorker() {
  clearTimeout(timer);
  timer = null;
}

// À appeler quand CE poste vient d'écrire quelque chose. Le temps que la réponse
// arrive à l'écran, l'évènement est déjà parti vers le hub — c'est ce qui donne
// l'impression de temps réel sans rien changer au reste.
//
// Sans effet sur le hub et sur un poste sans hub configuré : `timer` n'existe
// que là où le worker tourne.
export function nudgeSync() {
  if (!timer) return;
  if (running) { pending = true; return; }
  schedule(0);
}
