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
import { notSuperadmin } from '../../lib/visibility.js';
import { Decimal } from '../../lib/money.js';
// La quantité réellement arrivée sur une ligne fournisseur : même expression que
// celle qui décide du statut d'un ordre, pour que le tableau de bord et la fiche
// ne puissent pas se contredire.
import { ARRIVED } from '../orders/orderStatus.js';

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
      // order_id IS NULL : un bon fournisseur crée aussi une ligne dans `bons`
      // pour stocker sa marchandise — ce n'est pas un bon passager.
      const m = await metric(db, period, { from: 'bons b', dateCol: 'b.created_at', sumExpr: '1', where: 'b.order_id IS NULL' });
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM bons WHERE status <> 'regle' AND order_id IS NULL`);
      return { ...m, value: String(rows[0].n), created: m.value };
    }
    case 'passagers': {
      const m = await metric(db, period, { from: 'people p', dateCol: 'p.created_at', sumExpr: '1', where: 'p.is_passager' });
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM people WHERE active = TRUE AND is_passager');
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

  // Volumes = la marchandise REÇUE (bons fournisseurs). La compter aussi sur les
  // bons passagers reviendrait à compter deux fois les mêmes cartons : ils sont
  // reçus une fois, puis transportés.
  const [{ rows: bulk }, { rows: byUnit }] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(bl.weight_kg),0)::text AS kg,
              COALESCE(SUM(bl.cbm),0)::text      AS cbm,
              COUNT(DISTINCT b.id)::int          AS bons
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.created_at >= now() - $1::interval AND b.order_id IS NOT NULL`,
      [interval]
    ),
    // Quantities are NEVER summed across units — "3 cartons + 5 kg" is not a
    // number. They are reported per unit of measure.
    db.query(
      `SELECT bl.unit, SUM(bl.quantity)::text AS qty
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.created_at >= now() - $1::interval AND b.order_id IS NOT NULL
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
       FROM bons WHERE order_id IS NULL`
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
export async function activity(limit = 8, isSuper = false, db = getPool()) {
  // Sign-ins are audit noise on a dashboard — four admins logging in all day
  // would bury the business events this panel exists to show. They remain in
  // the full audit journal.
  const { rows } = await db.query(
    `SELECT al.id, al.action, al.entity, al.entity_id, al.details, al.created_at,
            a.full_name AS admin_name, a.role AS admin_role
       FROM audit_log al
       LEFT JOIN admins a ON a.id = al.admin_id
      WHERE al.action NOT LIKE 'auth.%'
        ${isSuper ? '' : `AND ${notSuperadmin('al.admin_id')}`}
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
            p.name AS passager_name,
            (SELECT string_agg(DISTINCT sf.name, ', ' ORDER BY sf.name)
               FROM bon_lines l JOIN bon_lines src ON src.id = l.source_line_id
               JOIN bons sb ON sb.id = src.bon_id
               JOIN people sf ON sf.id = sb.fournisseur_id
              WHERE l.bon_id = b.id) AS fournisseur_name
       FROM bons b
       LEFT JOIN people p ON p.id = b.passager_id
      WHERE b.order_id IS NULL
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ── one call for the whole page ──────────────────────────────────────
export async function overview({ period = 'mois', currency = 'DZD', isSuper = false } = {}) {
  const db = getPool();
  const [s, fin, rev, pipe, stock, act, bons, creances, aRegler, enAttente, manquants] = await Promise.all([
    stats(period, currency, db),
    financial(period, currency, db),
    revenue(period, currency, db),
    pipeline(db),
    stockByCategory(db),
    activity(4, isSuper, db),
    recentBons(4, db),
    receivables(currency, db),
    carriersToSettle(db),
    goodsWaiting(db),
    lossesByCarrier(currency, db),
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
    receivables: creances,
    carriersToSettle: aRegler,
    goodsWaiting: enAttente,
    lossesByCarrier: manquants,
  };
}

// ══ Ce qui appelle une action ════════════════════════════════════════
//
// Les blocs ci-dessus décrivent l'activité : combien, sur quelle période, en
// hausse ou en baisse. Ceux-ci décrivent ce qui CLOCHE — de l'argent qui dort,
// une marchandise que personne n'est venu chercher, un transporteur qui perd
// des colis. Ils ne se lisent pas pour se rassurer, ils se lisent pour agir.

// ── Créances et dettes ───────────────────────────────────────────────
// Le signe suit la convention du reste de l'application (voir ProfilePage) :
// solde > 0 = NOUS lui devons ; solde < 0 = IL nous doit.
//
// On somme par PERSONNE et non par rôle : quelqu'un peut être fournisseur et
// passager à la fois, et deux lignes de sens contraire pour le même nom
// donneraient deux fois la même personne dans deux colonnes opposées.
export async function receivables(currency = 'DZD', db = getPool(), limit = 5) {
  const net = `
    SELECT p.id, p.name, SUM(pb.balance) AS solde
      FROM person_balances pb
      JOIN people p ON p.id = pb.person_id
     WHERE pb.currency_code = $1
     GROUP BY p.id, p.name`;

  const [dus, dettes, totaux] = await Promise.all([
    // Ils nous doivent : les soldes négatifs, du plus lourd au plus léger.
    db.query(`WITH n AS (${net}) SELECT id, name, (-solde)::text AS montant FROM n
               WHERE solde < 0 ORDER BY solde ASC LIMIT $2`, [currency, limit]),
    // Nous leur devons.
    db.query(`WITH n AS (${net}) SELECT id, name, solde::text AS montant FROM n
               WHERE solde > 0 ORDER BY solde DESC LIMIT $2`, [currency, limit]),
    db.query(`WITH n AS (${net})
              SELECT COALESCE(SUM(-solde) FILTER (WHERE solde < 0), 0)::text AS a_recevoir,
                     COALESCE(SUM(solde)  FILTER (WHERE solde > 0), 0)::text AS a_payer,
                     COUNT(*) FILTER (WHERE solde < 0)::int AS nb_debiteurs,
                     COUNT(*) FILTER (WHERE solde > 0)::int AS nb_crediteurs
                FROM n`, [currency]),
  ]);

  return { currency, ...totaux.rows[0], debiteurs: dus.rows, crediteurs: dettes.rows };
}

// ── Transporteurs à régler ───────────────────────────────────────────
// La marchandise est arrivée, le transporteur n'a pas encore été réglé. Le tri
// est l'ancienneté et rien d'autre : c'est la seule chose qui rende la liste
// utile, et le plus vieux est toujours celui qu'on a oublié.
export async function carriersToSettle(db = getPool(), limit = 5) {
  const { rows } = await db.query(
    `SELECT b.id, b.reference, b.arrived_at, b.transport_fee::text AS montant,
            b.transport_currency AS devise, p.name AS passager,
            GREATEST(0, EXTRACT(day FROM now() - b.arrived_at)::int) AS jours
       FROM bons b
       LEFT JOIN people p ON p.id = b.passager_id
      WHERE b.status = 'arrive' AND b.passager_id IS NOT NULL
      ORDER BY b.arrived_at ASC NULLS FIRST, b.id
      LIMIT $1`,
    [limit]
  );
  const { rows: tot } = await db.query(
    `SELECT COUNT(*)::int AS nb,
            GREATEST(0, EXTRACT(day FROM now() - MIN(arrived_at))::int) AS plus_ancien
       FROM bons WHERE status = 'arrive' AND passager_id IS NOT NULL`
  );
  return { ...tot[0], lignes: rows };
}

// ── Marchandise arrivée, pas encore remise ───────────────────────────
// Groupée par PERSONNE, pas par commande : le geste qui vide ce tableau est un
// appel téléphonique, et on appelle quelqu'un — pas une référence.
export async function goodsWaiting(db = getPool(), limit = 5) {
  const base = `
    SELECT o.id AS order_id, o.fournisseur_id,
           GREATEST((${ARRIVED}) - COALESCE(bl.delivered_quantity, 0), 0) AS restant,
           (SELECT MIN(cb.arrived_at)
              FROM bon_lines cl JOIN bons cb ON cb.id = cl.bon_id
             WHERE cl.source_line_id = bl.id AND cb.status IN ('arrive','regle')) AS arrive_le
      FROM bon_lines bl
      JOIN bons b   ON b.id = bl.bon_id
      JOIN orders o ON o.id = b.order_id
     WHERE o.status IN ('arrivee','livree')`;

  const [parPersonne, totaux] = await Promise.all([
    db.query(
      `WITH l AS (${base})
       SELECT p.id, p.name,
              COUNT(DISTINCT l.order_id)::int AS commandes,
              SUM(l.restant)::text AS quantite,
              GREATEST(0, EXTRACT(day FROM now() - MIN(l.arrive_le))::int) AS jours
         FROM l JOIN people p ON p.id = l.fournisseur_id
        WHERE l.restant > 0.0005
        GROUP BY p.id, p.name
        ORDER BY MIN(l.arrive_le) ASC NULLS FIRST
        LIMIT $1`,
      [limit]
    ),
    db.query(
      `WITH l AS (${base})
       SELECT COUNT(DISTINCT order_id)::int AS commandes,
              COUNT(DISTINCT fournisseur_id)::int AS personnes,
              GREATEST(0, EXTRACT(day FROM now() - MIN(arrive_le))::int) AS plus_ancien
         FROM l WHERE restant > 0.0005`
    ),
  ]);

  return { ...totaux.rows[0], lignes: parPersonne.rows };
}

// ── Manquants par transporteur ───────────────────────────────────────
// Un manquant est un accident ; trois chez la même personne sont une habitude.
// C'est pourquoi on agrège par transporteur et sur plusieurs mois, et pourquoi
// le TAUX compte plus que le montant : il se compare d'un transporteur à
// l'autre, ce qu'une somme en dinars ne fait pas — les bons n'ont ni la même
// taille ni la même devise.
export async function lossesByCarrier(currency = 'DZD', db = getPool(), months = 6, limit = 5) {
  const { rows } = await db.query(
    `SELECT p.id, p.name,
            COUNT(*) FILTER (WHERE b.loss_total > 0)::int AS incidents,
            COUNT(*)::int AS bons,
            COALESCE(SUM(b.loss_total) FILTER (WHERE b.transport_currency = $2), 0)::text AS perte
       FROM bons b
       JOIN people p ON p.id = b.passager_id
      WHERE b.passager_id IS NOT NULL
        AND b.created_at >= now() - make_interval(months => $1::int)
      GROUP BY p.id, p.name
     HAVING COUNT(*) FILTER (WHERE b.loss_total > 0) > 0
      ORDER BY (COUNT(*) FILTER (WHERE b.loss_total > 0))::numeric / COUNT(*) DESC,
               COUNT(*) FILTER (WHERE b.loss_total > 0) DESC
      LIMIT $3`,
    [months, currency, limit]
  );
  return {
    months,
    currency,
    lignes: rows.map((r) => ({ ...r, taux: Math.round((r.incidents / r.bons) * 100) })),
  };
}
