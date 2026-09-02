// Dashboard aggregates. Everything the tableau de bord shows is computed here so
// the client makes one call instead of fetching six lists and summing them in the
// browser.
//
// Two rules this module obeys:
//   1. Money never becomes a JS float. Postgres returns NUMERIC as text and it
//      stays text all the way to the client; only percentages (which are not
//      money) are computed, via decimal.js.
//   2. Every money figure is scoped to ONE currency. The system holds
//      DZD/CNY/ALP/USD/EUR — adding them together would be meaningless — so the
//      caller passes a currency and the response echoes which one it used.
import { getPool } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';

// Window + sparkline resolution per period.
export const PERIODS = {
  jour: { interval: '1 day', buckets: 12, label: "aujourd'hui" },
  semaine: { interval: '7 days', buckets: 7, label: 'cette semaine' },
  mois: { interval: '30 days', buckets: 12, label: 'ce mois' },
  trimestre: { interval: '90 days', buckets: 12, label: 'ce trimestre' },
  annee: { interval: '365 days', buckets: 12, label: 'cette année' },
};

// Internal caisse movements — a conversion writes an 'in' AND an 'out' in the
// same caisse, a transfer moves money between our own caisses. Counting either
// as revenue or spending would double-count the books, so they are excluded from
// Entrées / Dépenses.
const EXTERNAL_ONLY = `t.type NOT IN ('conversion','transfer')`;

// ── generic helpers ──────────────────────────────────────────────────
// `from`, `dateCol`, `sumExpr` and `where` are module-internal SQL constants,
// never user input — user values always arrive as bound parameters.

// Current window vs the immediately preceding window of the same length.
// Both helpers bind [interval, buckets, ...extra] so a spec's own parameters
// always start at $3 and the same `where` string works for either query.
// ($2 is unused here but must still be referenced — Postgres rejects a bind
// with more parameters than placeholders.)
async function totals(db, period, { from, dateCol, sumExpr, where = '', params = [] }) {
  const { interval, buckets } = PERIODS[period];
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(${sumExpr}) FILTER (WHERE ${dateCol} >= now() - $1::interval), 0)::text AS cur,
       COALESCE(SUM(${sumExpr}) FILTER (WHERE ${dateCol} >= now() - ($1::interval * 2)
                                          AND ${dateCol} <  now() - $1::interval), 0)::text AS prev,
       $2::int AS _buckets
       FROM ${from} ${where ? `WHERE ${where}` : ''}`,
    [interval, buckets, ...params]
  );
  return { cur: rows[0].cur, prev: rows[0].prev };
}

// N evenly-spaced buckets across the window, as text values.
async function series(db, period, { from, dateCol, sumExpr, where = '', params = [] }) {
  const { interval, buckets } = PERIODS[period];
  // CTE aliases are prefixed so they can never collide with the domain table
  // being bucketed (a bare `b` clashed with `bons b`).
  const { rows } = await db.query(
    `WITH sc_win AS (SELECT now() - $1::interval AS t0, now() AS t1),
          sc_bkt AS (SELECT generate_series(0, $2::int - 1) AS i)
     SELECT sc_bkt.i, COALESCE(SUM(${sumExpr}), 0)::text AS v
       FROM sc_bkt CROSS JOIN sc_win
       LEFT JOIN ${from}
         ON ${dateCol} >= sc_win.t0 + (sc_win.t1 - sc_win.t0) * (sc_bkt.i::float / $2)
        AND ${dateCol} <  sc_win.t0 + (sc_win.t1 - sc_win.t0) * ((sc_bkt.i + 1)::float / $2)
        ${where ? `AND ${where}` : ''}
      GROUP BY sc_bkt.i
      ORDER BY sc_bkt.i`,
    [interval, buckets, ...params]
  );
  return rows.map((r) => r.v);
}

// null when there is no baseline to compare against — the UI shows "—" rather
// than inventing a percentage out of a division by zero.
function deltaPct(cur, prev) {
  const p = new Decimal(prev);
  if (p.isZero()) return null;
  return new Decimal(cur).minus(p).dividedBy(p.abs()).times(100).toDecimalPlaces(1).toNumber();
}

async function metric(db, period, spec) {
  const [{ cur, prev }, points] = await Promise.all([totals(db, period, spec), series(db, period, spec)]);
  return { value: cur, previous: prev, deltaPct: deltaPct(cur, prev), series: points };
}

// ── Résumé financier : Entrées / Dépenses / Net ──────────────────────
export async function financial(period = 'mois', currency = 'DZD', db = getPool()) {
  const base = {
    from: 'transactions t',
    dateCol: 't.created_at',
    where: `${EXTERNAL_ONLY} AND t.currency_code = $3`,
    params: [currency],
  };
  const [entrees, depenses] = await Promise.all([
    metric(db, period, { ...base, sumExpr: `CASE WHEN t.direction='in'  THEN t.amount ELSE 0 END` }),
    metric(db, period, { ...base, sumExpr: `CASE WHEN t.direction='out' THEN t.amount ELSE 0 END` }),
  ]);

  // Net = Entrées − Dépenses over the SAME window (a period flow, not a running
  // balance). Its sparkline is the two series subtracted point by point.
  const net = {
    value: new Decimal(entrees.value).minus(depenses.value).toFixed(2),
    previous: new Decimal(entrees.previous).minus(depenses.previous).toFixed(2),
    series: entrees.series.map((v, i) => new Decimal(v).minus(depenses.series[i] ?? 0).toFixed(2)),
  };
  net.deltaPct = deltaPct(net.value, net.previous);

  return { period, currency, entrees, depenses, net };
}

// ── one stat tile ─────────────────────────────────────────────────────
// The single source of truth for each dashboard tile, so the initial overview
// and the per-card period picker (GET /dashboard/tile/:key) return the same
// shape. Bons/Passagers headline the live active count while the sparkline +
// trend describe activity over the chosen window.
export async function tile(key, period = 'mois', currency = 'DZD', db = getPool()) {
  switch (key) {
    case 'bons': {
      const m = await metric(db, period, { from: 'bons b', dateCol: 'b.created_at', sumExpr: '1' });
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM bons WHERE status <> 'regle'`);
      return { ...m, value: String(rows[0].n), created: m.value };
    }
    case 'passagers': {
      const m = await metric(db, period, { from: 'passagers p', dateCol: 'p.created_at', sumExpr: '1' });
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM passagers WHERE active = TRUE');
      return { ...m, value: String(rows[0].n), created: m.value };
    }
    case 'stock':
      return stockLevel(db, period);
    case 'revenue':
      return revenue(period, currency, db);
    default:
      throw new Error(`Unknown tile '${key}'`);
  }
}

// ── the four stat tiles, for the initial overview ─────────────────────
export async function stats(period = 'mois', currency = 'DZD', db = getPool()) {
  const [bonsActifs, passagers, stock] = await Promise.all([
    tile('bons', period, currency, db),
    tile('passagers', period, currency, db),
    tile('stock', period, currency, db),
  ]);
  return { bonsActifs, passagers, stock };
}

// Stock total = live quantity across BOTH offices (stock_levels). The sparkline
// is that level reconstructed backwards through the stock_movements ledger.
async function stockLevel(db, period) {
  const { rows: totalRows } = await db.query(
    'SELECT COALESCE(SUM(quantity), 0)::text AS q FROM stock_levels'
  );
  const total = new Decimal(totalRows[0].q);

  const deltas = await series(db, period, {
    from: 'stock_movements sm',
    dateCol: 'sm.created_at',
    sumExpr: 'sm.quantity_delta',
  });

  // Walk backwards: the level at the end of bucket i is today's total minus
  // every correction that happened after it.
  const levels = new Array(deltas.length);
  let running = total;
  for (let i = deltas.length - 1; i >= 0; i -= 1) {
    levels[i] = running.toFixed(3);
    running = running.minus(new Decimal(deltas[i]));
  }
  const first = new Decimal(levels[0] ?? total);
  return {
    value: total.toFixed(3),
    previous: first.toFixed(3),
    deltaPct: deltaPct(total.toFixed(3), first.toFixed(3)),
    series: levels,
  };
}

// ── chiffre d'affaires, both measures ────────────────────────────────
export async function revenue(period = 'mois', currency = 'DZD', db = getPool()) {
  const { interval } = PERIODS[period];

  const money = await metric(db, period, {
    from: 'person_ledger pl',
    dateCol: 'pl.created_at',
    sumExpr: 'pl.amount',
    where: `pl.type = 'fee_payment' AND pl.currency_code = $3`,
    params: [currency],
  });

  const [{ rows: bulk }, { rows: byUnit }] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(bl.weight_kg),0)::text AS kg,
              COALESCE(SUM(bl.cbm),0)::text      AS cbm,
              COUNT(DISTINCT b.id)::int          AS bons
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.created_at >= now() - $1::interval`,
      [interval]
    ),
    // Quantities are NEVER summed across units — "3 cartons + 5 kg" is not a
    // number. They are reported per unit of measure.
    db.query(
      `SELECT bl.unit, SUM(bl.quantity)::text AS qty
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.created_at >= now() - $1::interval
        GROUP BY bl.unit
        ORDER BY SUM(bl.quantity) DESC`,
      [interval]
    ),
  ]);

  return {
    period,
    currency,
    money,
    quantity: {
      weightKg: bulk[0].kg,
      cbm: bulk[0].cbm,
      bons: bulk[0].bons,
      byUnit: byUnit.map((r) => ({ unit: r.unit, quantity: r.qty })),
    },
  };
}

// ── pipeline : 5 steps ───────────────────────────────────────────────
// Steps 1-4 are the stored bon statuses. Step 5 "Terminé" is DERIVED: the bon is
// réglé AND nothing is outstanding on it — the fournisseur's fee has been
// collected (their entries for this bon net to >= 0) and the passager has been
// paid (their entries net to <= 0). Sign convention: person_balances.balance is
// what the business owes the person.
export async function pipeline(db = getPool()) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'cree')       ::int AS en_attente,
       COUNT(*) FILTER (WHERE status = 'en_transit') ::int AS en_transit,
       COUNT(*) FILTER (WHERE status = 'arrive')     ::int AS arrive,
       COUNT(*) FILTER (WHERE status = 'regle')      ::int AS regle,
       COUNT(*)                                      ::int AS total
       FROM bons`
  );
  const r = rows[0];
  const steps = [
    { key: 'en_attente', label: 'En attente', count: r.en_attente },
    { key: 'en_transit', label: 'En transit', count: r.en_transit },
    { key: 'arrive', label: 'Arrivé', count: r.arrive },
    { key: 'regle', label: 'Réglé', count: r.regle },
  ];
  const total = r.total || 0;
  for (const s of steps) s.pct = total ? Math.round((s.count / total) * 100) : 0;

  const { rows: ord } = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`
  );
  const orders = Object.fromEntries(ord.map((o) => [o.status, o.n]));

  return { steps, total, orders };
}

// ── donut : stock par catégorie ──────────────────────────────────────
export async function stockByCategory(db = getPool(), top = 5) {
  const { rows } = await db.query(
    `SELECT COALESCE(c.name, 'Sans catégorie') AS name,
            COUNT(DISTINCT i.id)::int          AS items,
            COALESCE(SUM(l.quantity), 0)::text AS quantity
       FROM stock_items i
       LEFT JOIN stock_categories c ON c.id = i.category_id
       LEFT JOIN stock_levels l ON l.item_id = i.id
      WHERE i.active = TRUE
      GROUP BY c.name
      ORDER BY SUM(l.quantity) DESC NULLS LAST`
  );

  const total = rows.reduce((acc, r) => acc.plus(new Decimal(r.quantity)), new Decimal(0));
  // Categories are admin-created and unbounded, so anything past the top N is
  // rolled into "Autres" rather than producing a 30-slice donut.
  const head = rows.slice(0, top);
  const tail = rows.slice(top);
  const slices = head.map((r) => ({ name: r.name, items: r.items, quantity: r.quantity }));
  if (tail.length) {
    slices.push({
      name: 'Autres',
      items: tail.reduce((n, r) => n + r.items, 0),
      quantity: tail.reduce((acc, r) => acc.plus(new Decimal(r.quantity)), new Decimal(0)).toFixed(3),
    });
  }
  for (const s of slices) {
    s.pct = total.isZero() ? 0 : new Decimal(s.quantity).dividedBy(total).times(100).toDecimalPlaces(1).toNumber();
  }
  return { total: total.toFixed(3), slices };
}

// ── activité récente ─────────────────────────────────────────────────
export async function activity(limit = 8, db = getPool()) {
  // Sign-ins are audit noise on a dashboard — four admins logging in all day
  // would bury the business events this panel exists to show. They remain in
  // the full audit journal.
  const { rows } = await db.query(
    `SELECT al.id, al.action, al.entity, al.entity_id, al.details, al.created_at,
            a.full_name AS admin_name
       FROM audit_log al
       LEFT JOIN admins a ON a.id = al.admin_id
      WHERE al.action NOT LIKE 'auth.%'
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ── bons récents ─────────────────────────────────────────────────────
export async function recentBons(limit = 5, db = getPool()) {
  const { rows } = await db.query(
    `SELECT b.id, b.reference, b.status, b.created_at, b.transport_fee, b.transport_currency,
            f.name AS fournisseur_name, p.full_name AS passager_name
       FROM bons b
       JOIN fournisseurs f ON f.id = b.fournisseur_id
       LEFT JOIN passagers p ON p.id = b.passager_id
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ── one call for the whole page ──────────────────────────────────────
export async function overview({ period = 'mois', currency = 'DZD' } = {}) {
  const db = getPool();
  const [s, fin, rev, pipe, stock, act, bons] = await Promise.all([
    stats(period, currency, db),
    financial(period, currency, db),
    revenue(period, currency, db),
    pipeline(db),
    stockByCategory(db),
    activity(4, db),
    recentBons(4, db),
  ]);
  return {
    period,
    periodLabel: PERIODS[period].label,
    currency,
    stats: s,
    financial: fin,
    revenue: rev,
    pipeline: pipe,
    stockByCategory: stock,
    activity: act,
    recentBons: bons,
  };
}
