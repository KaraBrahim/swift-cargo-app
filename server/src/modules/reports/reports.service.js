// Rapports. Every figure is read straight from the append-only ledgers, so a
// report can always be re-derived and never drifts from the caisse.
//
// As everywhere else in this app: money stays a decimal STRING end to end, and
// every report is scoped to a single currency — mixing DZD with CNY in one total
// would be meaningless.
import { getPool } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { PERIODS } from '../dashboard/dashboard.service.js';

const interval = (period) => (PERIODS[period] ?? PERIODS.mois).interval;

// ── 1. Synthèse financière ───────────────────────────────────────────
export async function financialSummary({ period = 'mois', currency = 'DZD' } = {}, db = getPool()) {
  const iv = interval(period);

  const [movements, byType, persons] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::text  AS entrees,
         COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::text AS depenses,
         COUNT(*)::int                                                   AS mouvements
         FROM transactions
        WHERE created_at >= now() - $1::interval
          AND currency_code = $2
          AND type NOT IN ('conversion','transfer')`,
      [iv, currency]
    ),
    db.query(
      `SELECT type,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::text  AS entrees,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::text AS depenses,
              COUNT(*)::int AS n
         FROM transactions
        WHERE created_at >= now() - $1::interval AND currency_code = $2
        GROUP BY type ORDER BY type`,
      [iv, currency]
    ),
    db.query(
      `SELECT
         COALESCE(SUM(-balance) FILTER (WHERE balance < 0), 0)::text AS creances,
         COALESCE(SUM(balance)  FILTER (WHERE balance > 0), 0)::text AS dettes
         FROM person_balances WHERE currency_code = $1`,
      [currency]
    ),
  ]);

  const m = movements.rows[0];
  return {
    period,
    currency,
    entrees: m.entrees,
    depenses: m.depenses,
    net: new Decimal(m.entrees).minus(m.depenses).toFixed(2),
    mouvements: m.mouvements,
    parType: byType.rows,
    creances: persons.rows[0].creances,
    dettes: persons.rows[0].dettes,
  };
}

// ── 2. Relevé de caisse ──────────────────────────────────────────────
export async function caisseStatement({ caisseId, period = 'mois', currency = 'DZD' } = {}, db = getPool()) {
  const iv = interval(period);
  const [caisse, opening, lines] = await Promise.all([
    db.query('SELECT id, label, kind, office FROM caisses WHERE id = $1', [caisseId]),
    // Opening balance = every movement before the window, re-summed.
    db.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)::text AS solde
         FROM transactions
        WHERE caisse_id = $1 AND currency_code = $2 AND created_at < now() - $3::interval`,
      [caisseId, currency, iv]
    ),
    db.query(
      `SELECT t.id, t.created_at, t.type, t.direction, t.amount::text, t.balance_after::text,
              t.note, a.full_name AS admin_name, a.role AS admin_role
         FROM transactions t JOIN admins a ON a.id = t.admin_id
        WHERE t.caisse_id = $1 AND t.currency_code = $2 AND t.created_at >= now() - $3::interval
        ORDER BY t.created_at, t.id`,
      [caisseId, currency, iv]
    ),
  ]);

  if (!caisse.rows[0]) return null;

  let running = new Decimal(opening.rows[0].solde);
  const entries = lines.rows.map((r) => {
    running = r.direction === 'in' ? running.plus(r.amount) : running.minus(r.amount);
    return { ...r, solde: running.toFixed(2) };
  });

  const entrees = lines.rows.filter((r) => r.direction === 'in').reduce((a, r) => a.plus(r.amount), new Decimal(0));
  const depenses = lines.rows.filter((r) => r.direction === 'out').reduce((a, r) => a.plus(r.amount), new Decimal(0));

  return {
    caisse: caisse.rows[0],
    period,
    currency,
    soldeOuverture: opening.rows[0].solde,
    soldeCloture: running.toFixed(2),
    entrees: entrees.toFixed(2),
    depenses: depenses.toFixed(2),
    entries,
  };
}

// ── 3. Relevé de compte d'une personne ───────────────────────────────
// Un seul relevé : ce qu'elle doit comme fournisseur et ce qu'on lui doit comme
// passager sont deux lignes du même compte.
export async function personStatement({ personType = 'personne', personId, currency = 'DZD' } = {}, db = getPool()) {
  const table = personType === 'utilisateur' ? 'admins' : 'people';
  const nameCol = table === 'admins' ? 'full_name' : 'name';

  const [person, balance, entries] = await Promise.all([
    db.query(
      table === 'admins'
        ? `SELECT id, full_name AS name, phone FROM admins WHERE id = $1`
        : `SELECT id, name, phone, is_fournisseur, is_passager FROM people WHERE id = $1`,
      [personId]
    ),
    db.query(
      `SELECT COALESCE(balance, 0)::text AS solde FROM person_balances
        WHERE person_type = $1 AND person_id = $2 AND currency_code = $3`,
      [personType, personId, currency]
    ),
    db.query(
      `SELECT pl.created_at, pl.type, pl.amount::text, pl.balance_after::text, pl.note,
              b.reference AS bon_reference, o.reference AS order_reference, a.full_name AS admin_name, a.role AS admin_role
         FROM person_ledger pl
         JOIN admins a ON a.id = pl.admin_id
         LEFT JOIN bons b ON b.id = pl.ref_bon_id
         LEFT JOIN orders o ON o.id = pl.ref_order_id
        WHERE pl.person_type = $1 AND pl.person_id = $2 AND pl.currency_code = $3
        ORDER BY pl.created_at, pl.id`,
      [personType, personId, currency]
    ),
  ]);

  if (!person.rows[0]) return null;
  return {
    person: { ...person.rows[0], person_type: personType },
    currency,
    // Sign convention: > 0 = the business owes them, < 0 = they owe the business.
    solde: balance.rows[0]?.solde ?? '0.00',
    entries: entries.rows,
  };
}

// ── 4. Rentabilité par ordre ─────────────────────────────────────────
export async function orderProfitability({ period = 'mois', currency = 'DZD' } = {}, db = getPool()) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.created_at, f.name AS fournisseur_name,
            COUNT(b.id)::int                             AS bons,
            COALESCE(SUM(b.transport_fee), 0)::text      AS facture,
            COALESCE(SUM(b.passager_payment), 0)::text   AS paye_passagers,
            COALESCE(SUM(b.loss_total), 0)::text         AS pertes,
            (COALESCE(SUM(b.transport_fee), 0)
             - COALESCE(SUM(b.passager_payment), 0))::text AS marge
       FROM orders o
       JOIN people f ON f.id = o.fournisseur_id
       LEFT JOIN bons b ON b.order_id = o.id AND b.transport_currency = $2
      WHERE o.created_at >= now() - $1::interval
      GROUP BY o.id, f.name
      ORDER BY o.created_at DESC`,
    [interval(period), currency]
  );

  const totals = rows.reduce(
    (acc, r) => ({
      facture: acc.facture.plus(r.facture),
      paye_passagers: acc.paye_passagers.plus(r.paye_passagers),
      pertes: acc.pertes.plus(r.pertes),
      marge: acc.marge.plus(r.marge),
    }),
    { facture: new Decimal(0), paye_passagers: new Decimal(0), pertes: new Decimal(0), marge: new Decimal(0) }
  );

  return {
    period,
    currency,
    rows,
    totals: {
      facture: totals.facture.toFixed(2),
      paye_passagers: totals.paye_passagers.toFixed(2),
      pertes: totals.pertes.toFixed(2),
      marge: totals.marge.toFixed(2),
    },
  };
}

// ── 5. Rapport des pertes ────────────────────────────────────────────
export async function lossesReport({ period = 'mois' } = {}, db = getPool()) {
  const [lines, byResponsible] = await Promise.all([
    db.query(
      `SELECT b.reference, b.created_at, f.name AS fournisseur_name, p.name AS passager_name,
              bl.designation, bl.quantity::text, bl.received_quantity::text,
              (bl.quantity - COALESCE(bl.received_quantity, bl.quantity))::text AS manquant,
              bl.unit, bl.loss_value::text, bl.responsible, b.transport_currency
         FROM bon_lines bl
         JOIN bons b ON b.id = bl.bon_id
         LEFT JOIN people f ON f.id = b.fournisseur_id
         LEFT JOIN people p ON p.id = b.passager_id
        WHERE bl.loss_value > 0 AND b.created_at >= now() - $1::interval
        ORDER BY b.created_at DESC, bl.id`,
      [interval(period)]
    ),
    db.query(
      `SELECT COALESCE(NULLIF(bl.responsible, ''), 'Non attribué') AS responsable,
              COUNT(*)::int AS lignes,
              SUM(bl.loss_value)::text AS total
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE bl.loss_value > 0 AND b.created_at >= now() - $1::interval
        GROUP BY 1 ORDER BY SUM(bl.loss_value) DESC`,
      [interval(period)]
    ),
  ]);

  const total = lines.rows.reduce((a, r) => a.plus(r.loss_value), new Decimal(0));
  return { period, total: total.toFixed(2), lines: lines.rows, byResponsible: byResponsible.rows };
}
