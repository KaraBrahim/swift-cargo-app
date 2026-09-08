// Rapports. Every figure is read straight from the append-only ledgers, so a
// report can always be re-derived and never drifts from the caisse.
//
// As everywhere else in this app: money stays a decimal STRING end to end, and
// every report is scoped to a single currency — mixing DZD with CNY in one total
// would be meaningless.
//
// ── Sur les dates ────────────────────────────────────────────────────
// Ces rapports tournaient sur une fenêtre GLISSANTE : « ce mois » valait
// `now() - '30 days'`. Au 8 septembre, cela répondait « du 9 août au
// 8 septembre » — jamais septembre. On ne pouvait donc ni clôturer un mois, ni
// le comparer au précédent. Chaque fenêtre est maintenant une plage de jours
// civils bornée, résolue dans le fuseau du bureau. Voir lib/dates.js.
import { getPool } from '../../db/pool.js';
import { Decimal } from '../../lib/money.js';
import { RANGE_SQL, BEFORE_SQL, parseRange, tzLabel } from '../../lib/dates.js';

// L'entête que tout rapport renvoie : la question à laquelle il répond.
//
// `report` porte le nom du rapport. L'écran en a besoin : en changeant
// d'onglet il garde brièvement les données du précédent pendant que les
// nouvelles arrivent, et lire `totals.facture` dans une réponse « argent »
// plante la page. Le nom permet de n'afficher que ce qui correspond.
const head = (report, range, extra = {}) => ({
  report, from: range.from, to: range.to, tz: range.tz, tzLabel: tzLabel(range.tz), ...extra,
});

// Les mouvements qui font vraiment entrer ou sortir de l'argent de la maison.
// Une conversion et un transfert déplacent de l'argent qu'on possède déjà :
// les compter en « entrées » gonflerait le chiffre sans qu'un dinar de plus
// soit entré. Ils ont leur propre bloc dans le rapport Argent.
const EXTERNAL_ONLY = "type NOT IN ('conversion','transfer')";

// ── 1. Synthèse financière ───────────────────────────────────────────
export async function financialSummary({ from, to, currency = 'DZD' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const p = [range.from, range.to, range.tz, currency];
  const win = RANGE_SQL('created_at', 1, 2, 3);

  const [movements, byType, persons] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::text  AS entrees,
         COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::text AS depenses,
         COUNT(*)::int                                                   AS mouvements
         FROM transactions
        WHERE ${win} AND currency_code = $4 AND ${EXTERNAL_ONLY}`,
      p
    ),
    // Le détail portait sur TOUS les types alors que l'entête en excluait deux :
    // les lignes ne totalisaient pas l'entête, et rien ne le disait. Même
    // filtre des deux côtés, désormais — la somme des lignes EST l'entête.
    db.query(
      `SELECT type,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::text  AS entrees,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::text AS depenses,
              COUNT(*)::int AS n
         FROM transactions
        WHERE ${win} AND currency_code = $4 AND ${EXTERNAL_ONLY}
        GROUP BY type ORDER BY type`,
      p
    ),
    // Créances et dettes sont un ÉTAT, pas un flux : ce qui est dû aujourd'hui,
    // quelle que soit la période regardée. Le champ le dit.
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
    ...head('financial', range, { currency }),
    entrees: m.entrees,
    depenses: m.depenses,
    net: new Decimal(m.entrees).minus(m.depenses).toFixed(2),
    mouvements: m.mouvements,
    parType: byType.rows,
    creances: persons.rows[0].creances,
    dettes: persons.rows[0].dettes,
    soldesAJour: true,
  };
}

// ── 2. Relevé de caisse ──────────────────────────────────────────────
export async function caisseStatement({ caisseId, from, to, currency = 'DZD' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const p = [caisseId, currency, range.from, range.to, range.tz];

  const [caisse, opening, lines] = await Promise.all([
    db.query('SELECT id, label, kind, office FROM caisses WHERE id = $1', [caisseId]),
    // L'à-nouveau : tout ce qui précède le premier jour, resommé. Un relevé qui
    // commence en l'air ne se vérifie pas.
    db.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)::text AS solde
         FROM transactions
        WHERE caisse_id = $1 AND currency_code = $2 AND ${BEFORE_SQL('created_at', 3, 4)}`,
      // Ses propres liaisons : cette requête ne lit pas la borne haute, et un
      // paramètre passé mais jamais référencé fait échouer l'analyse (42P18).
      [caisseId, currency, range.from, range.tz]
    ),
    db.query(
      `SELECT t.id, t.created_at, t.type, t.direction, t.amount::text, t.balance_after::text,
              t.note, a.full_name AS admin_name, a.role AS admin_role
         FROM transactions t JOIN admins a ON a.id = t.admin_id
        WHERE t.caisse_id = $1 AND t.currency_code = $2 AND ${RANGE_SQL('t.created_at', 3, 4, 5)}
        ORDER BY t.created_at, t.id`,
      p
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
    ...head('caisse', range, { currency }),
    caisse: caisse.rows[0],
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
export async function personStatement({ personType = 'personne', personId, from, to, currency = 'DZD' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const table = personType === 'utilisateur' ? 'admins' : 'people';
  const p = [personType, personId, currency, range.from, range.to, range.tz];

  const [person, opening, entries, live] = await Promise.all([
    db.query(
      table === 'admins'
        ? `SELECT id, full_name AS name, phone FROM admins WHERE id = $1`
        : `SELECT id, uuid, name, phone, is_fournisseur, is_passager FROM people WHERE id = $1`,
      [personId]
    ),
    // Ce relevé n'avait AUCUN filtre de date : il rendait toute l'histoire de la
    // personne, toujours. Il a maintenant une plage — donc il lui faut un
    // à-nouveau, calculé depuis le grand livre et non lu sur le solde courant,
    // qui ne sait rien d'une date.
    db.query(
      `SELECT COALESCE(SUM(amount), 0)::text AS solde FROM person_ledger
        WHERE person_type = $1 AND person_id = $2 AND currency_code = $3
          AND ${BEFORE_SQL('created_at', 4, 5)}`,
      [personType, personId, currency, range.from, range.tz]
    ),
    db.query(
      `SELECT pl.created_at, pl.type, pl.amount::text, pl.balance_after::text, pl.note,
              b.reference AS bon_reference, o.reference AS order_reference, a.full_name AS admin_name, a.role AS admin_role
         FROM person_ledger pl
         JOIN admins a ON a.id = pl.admin_id
         LEFT JOIN bons b ON b.id = pl.ref_bon_id
         LEFT JOIN orders o ON o.id = pl.ref_order_id
        WHERE pl.person_type = $1 AND pl.person_id = $2 AND pl.currency_code = $3
          AND ${RANGE_SQL('pl.created_at', 4, 5, 6)}
        ORDER BY pl.created_at, pl.id`,
      p
    ),
    db.query(
      `SELECT COALESCE(balance, 0)::text AS solde FROM person_balances
        WHERE person_type = $1 AND person_id = $2 AND currency_code = $3`,
      [personType, personId, currency]
    ),
  ]);

  if (!person.rows[0]) return null;

  const ouverture = new Decimal(opening.rows[0].solde);
  const cloture = entries.rows.reduce((a, r) => a.plus(r.amount), ouverture);

  return {
    ...head('person', range, { currency }),
    person: { ...person.rows[0], person_type: personType },
    // Sign convention: > 0 = the business owes them, < 0 = they owe the business.
    soldeOuverture: ouverture.toFixed(2),
    soldeCloture: cloture.toFixed(2),
    // Le solde d'aujourd'hui, qui n'est pas celui de fin de période dès que la
    // plage s'arrête dans le passé. Les deux sont utiles ; les confondre, non.
    soldeActuel: live.rows[0]?.solde ?? '0.00',
    entries: entries.rows,
  };
}

// ── 4. Rentabilité par ordre ─────────────────────────────────────────
// Les trois dates d'un bon racontent trois histoires : ce qu'on a PRIS en
// charge, ce qui est ARRIVÉ, ce qui a été RÉGLÉ. Le rapport laisse choisir —
// sinon il répond à une question qu'on ne lui a pas posée.
const ORDER_DATE_COL = {
  creation: 'o.created_at',
  arrivee: 'o.arrived_at',
  reglement: 'o.closed_at',
};

export async function orderProfitability({ from, to, currency = 'DZD', dateBy = 'creation' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const col = ORDER_DATE_COL[dateBy] ?? ORDER_DATE_COL.creation;
  const p = [range.from, range.to, range.tz, currency];

  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.created_at, o.arrived_at, o.closed_at, f.name AS fournisseur_name,
            COUNT(b.id)::int                             AS bons,
            COALESCE(SUM(b.transport_fee), 0)::text      AS facture,
            COALESCE(SUM(b.commission), 0)::text         AS commission,
            COALESCE(SUM(b.passager_payment), 0)::text   AS paye_passagers,
            COALESCE(SUM(b.loss_total), 0)::text         AS pertes,
            (COALESCE(SUM(b.transport_fee), 0)
             - COALESCE(SUM(b.passager_payment), 0))::text AS marge
       FROM orders o
       JOIN people f ON f.id = o.fournisseur_id
       LEFT JOIN bons b ON b.order_id = o.id AND b.transport_currency = $4
      WHERE ${RANGE_SQL(col, 1, 2, 3)}
      GROUP BY o.id, f.name
      ORDER BY ${col} DESC`,
    p
  );

  const sum = (field) => rows.reduce((a, r) => a.plus(r[field]), new Decimal(0));
  return {
    ...head('orders', range, { currency, dateBy }),
    rows,
    totals: {
      facture: sum('facture').toFixed(2),
      commission: sum('commission').toFixed(2),
      paye_passagers: sum('paye_passagers').toFixed(2),
      pertes: sum('pertes').toFixed(2),
      marge: sum('marge').toFixed(2),
    },
  };
}

// ── 5. Rapport des pertes ────────────────────────────────────────────
const BON_DATE_COL = { creation: 'b.created_at', arrivee: 'b.arrived_at', reglement: 'b.settled_at' };

export async function lossesReport({ from, to, dateBy = 'creation' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const col = BON_DATE_COL[dateBy] ?? BON_DATE_COL.creation;
  const p = [range.from, range.to, range.tz];
  const win = RANGE_SQL(col, 1, 2, 3);

  const [lines, byResponsible] = await Promise.all([
    db.query(
      `SELECT b.reference, b.created_at, b.arrived_at, b.settled_at,
              f.name AS fournisseur_name, p.name AS passager_name,
              bl.designation, bl.quantity::text, bl.received_quantity::text,
              (bl.quantity - COALESCE(bl.received_quantity, bl.quantity))::text AS manquant,
              bl.unit, bl.loss_value::text, bl.responsible, b.transport_currency
         FROM bon_lines bl
         JOIN bons b ON b.id = bl.bon_id
         LEFT JOIN people f ON f.id = b.fournisseur_id
         LEFT JOIN people p ON p.id = b.passager_id
        WHERE bl.loss_value > 0 AND ${win}
        ORDER BY ${col} DESC, bl.id`,
      p
    ),
    db.query(
      `SELECT COALESCE(NULLIF(bl.responsible, ''), 'Non attribué') AS responsable,
              COUNT(*)::int AS lignes,
              SUM(bl.loss_value)::text AS total
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE bl.loss_value > 0 AND ${win}
        GROUP BY 1 ORDER BY SUM(bl.loss_value) DESC`,
      p
    ),
  ]);

  // Le total agrège des lignes de devises différentes — un bon passager peut
  // porter des lots facturés en CNY et en DZD. On rend donc AUSSI le détail par
  // devise ; le total global reste, mais il ne prétend plus être un montant.
  const parDevise = {};
  for (const r of lines.rows) {
    parDevise[r.transport_currency] = new Decimal(parDevise[r.transport_currency] ?? 0)
      .plus(r.loss_value).toFixed(2);
  }

  return {
    ...head('losses', range, { dateBy }),
    total: lines.rows.reduce((a, r) => a.plus(r.loss_value), new Decimal(0)).toFixed(2),
    parDevise,
    lines: lines.rows,
    byResponsible: byResponsible.rows,
  };
}

// ── 6. Argent : le journal complet de la période ─────────────────────
// Conversions, transferts et charges n'avaient AUCUN rapport. Ils sont ici,
// chacun dans son bloc, parce qu'ils ne se totalisent pas avec le reste :
// une conversion ne fait pas entrer d'argent, elle en change la couleur.
export async function moneyReport({ from, to, currency = 'DZD' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const p = [range.from, range.to, range.tz, currency];
  const win = (col) => RANGE_SQL(col, 1, 2, 3);

  const [parCaisse, conversions, transferts, charges] = await Promise.all([
    // Par caisse : à-nouveau, flux, clôture. Trois nombres qui se vérifient
    // l'un l'autre — ouverture + entrées − sorties doit faire clôture.
    db.query(
      `SELECT c.id, c.label, c.office,
              COALESCE(SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
                       FILTER (WHERE ${BEFORE_SQL('t.created_at', 1, 3)}), 0)::text AS ouverture,
              COALESCE(SUM(t.amount) FILTER (WHERE t.direction='in'  AND ${win('t.created_at')}), 0)::text AS entrees,
              COALESCE(SUM(t.amount) FILTER (WHERE t.direction='out' AND ${win('t.created_at')}), 0)::text AS sorties,
              COUNT(*) FILTER (WHERE ${win('t.created_at')})::int AS mouvements
         FROM caisses c
         LEFT JOIN transactions t ON t.caisse_id = c.id AND t.currency_code = $4
        WHERE c.active
        GROUP BY c.id, c.label, c.office
        ORDER BY c.kind, CASE c.office WHEN 'algeria' THEN 0 WHEN 'china' THEN 1 ELSE 2 END, c.id`,
      p
    ),
    db.query(
      `SELECT cv.id, cv.created_at, cv.from_currency, cv.to_currency,
              cv.from_amount::text, cv.to_amount::text, cv.effective_rate::text, cv.dzd_value::text,
              c.label AS caisse_label, a.full_name AS admin_name
         FROM conversions cv
         JOIN caisses c ON c.id = cv.caisse_id
         JOIN admins a ON a.id = cv.admin_id
        WHERE ${win('cv.created_at')}
        ORDER BY cv.created_at DESC, cv.id DESC`,
      [range.from, range.to, range.tz]
    ),
    db.query(
      `SELECT t.id, t.reference, t.sent_at, t.received_at, t.status, t.forced,
              t.currency_code, t.amount::text, t.from_office, t.to_office,
              sc.label AS sent_caisse_label, rc.label AS received_caisse_label
         FROM office_transfers t
         LEFT JOIN caisses sc ON sc.id = t.sent_caisse_id
         LEFT JOIN caisses rc ON rc.id = t.received_caisse_id
        WHERE ${win('t.sent_at')}
        ORDER BY t.sent_at DESC, t.id DESC`,
      [range.from, range.to, range.tz]
    ),
    db.query(
      `SELECT ch.category, COUNT(*)::int AS n, SUM(ch.amount)::text AS total
         FROM charges ch
        WHERE ${win('ch.created_at')} AND ch.currency_code = $4
        GROUP BY ch.category ORDER BY SUM(ch.amount) DESC`,
      p
    ),
  ]);

  const caisses = parCaisse.rows.map((r) => ({
    ...r,
    cloture: new Decimal(r.ouverture).plus(r.entrees).minus(r.sorties).toFixed(2),
  }));

  const sum = (rows, field) => rows.reduce((a, r) => a.plus(r[field]), new Decimal(0));
  return {
    ...head('money', range, { currency }),
    caisses,
    totaux: {
      ouverture: sum(caisses, 'ouverture').toFixed(2),
      entrees: sum(caisses, 'entrees').toFixed(2),
      sorties: sum(caisses, 'sorties').toFixed(2),
      cloture: sum(caisses, 'cloture').toFixed(2),
    },
    conversions: conversions.rows,
    transferts: transferts.rows,
    charges: charges.rows,
    chargesTotal: sum(charges.rows, 'total').toFixed(2),
  };
}

// ── 7. Personnes : qui doit quoi, sur la période ─────────────────────
export async function peopleReport({ from, to, currency = 'DZD' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const p = [range.from, range.to, range.tz, currency];

  const { rows } = await db.query(
    `SELECT pe.id, pe.name, pe.phone, pe.is_fournisseur, pe.is_passager,
            COALESCE(SUM(-pl.amount) FILTER (WHERE pl.type = 'transport_fee'), 0)::text     AS facture,
            COALESCE(SUM(pl.amount)  FILTER (WHERE pl.type = 'fee_payment'), 0)::text       AS encaisse,
            COALESCE(SUM(pl.amount)  FILTER (WHERE pl.type = 'passager_due'), 0)::text      AS du_transport,
            COALESCE(SUM(-pl.amount) FILTER (WHERE pl.type = 'passager_payment'), 0)::text  AS paye,
            COALESCE(SUM(-pl.amount) FILTER (WHERE pl.type = 'passager_manquant'), 0)::text AS manquants,
            COUNT(*)::int AS ecritures,
            COALESCE(pb.balance, 0)::text AS solde_actuel
       FROM person_ledger pl
       JOIN people pe ON pe.id = pl.person_id AND pl.person_type = 'personne'
       LEFT JOIN person_balances pb
              ON pb.person_type = 'personne' AND pb.person_id = pe.id AND pb.currency_code = $4
      WHERE pl.currency_code = $4 AND ${RANGE_SQL('pl.created_at', 1, 2, 3)}
      GROUP BY pe.id, pe.name, pe.phone, pe.is_fournisseur, pe.is_passager, pb.balance
      ORDER BY pe.name`,
    p
  );

  const sum = (field) => rows.reduce((a, r) => a.plus(r[field]), new Decimal(0));
  return {
    ...head('people', range, { currency }),
    rows,
    totals: {
      facture: sum('facture').toFixed(2),
      encaisse: sum('encaisse').toFixed(2),
      du_transport: sum('du_transport').toFixed(2),
      paye: sum('paye').toFixed(2),
      manquants: sum('manquants').toFixed(2),
    },
  };
}

// ── 8. Marchandises : ce qui a bougé ─────────────────────────────────
export async function goodsReport({ from, to, dateBy = 'creation' } = {}, db = getPool()) {
  const range = parseRange({ from, to });
  const col = BON_DATE_COL[dateBy] ?? BON_DATE_COL.creation;
  const p = [range.from, range.to, range.tz];

  const [parStatut, articles, mouvements, enTransit] = await Promise.all([
    db.query(
      `SELECT b.status, (b.order_id IS NULL) AS est_passager, COUNT(*)::int AS n
         FROM bons b WHERE ${RANGE_SQL(col, 1, 2, 3)}
        GROUP BY b.status, est_passager ORDER BY b.status`,
      p
    ),
    db.query(
      `SELECT COALESCE(bl.designation, '—') AS designation,
              COUNT(*)::int AS lignes,
              SUM(bl.quantity)::text  AS quantite,
              SUM(bl.weight_kg)::text AS poids,
              SUM(bl.cbm)::text       AS cbm,
              SUM(bl.unit_price * (CASE WHEN bl.measure='poids' THEN bl.weight_kg
                                        WHEN bl.measure='cbm'   THEN bl.cbm
                                        ELSE bl.quantity END))::text AS valeur
         FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id
        WHERE b.order_id IS NOT NULL AND ${RANGE_SQL(col, 1, 2, 3)}
        GROUP BY 1 ORDER BY 6 DESC NULLS LAST LIMIT 100`,
      p
    ),
    // Les mouvements de stock n'avaient jamais eu de rapport.
    db.query(
      `SELECT sm.office, sm.reason, COUNT(*)::int AS n,
              SUM(sm.quantity_delta)::text AS quantite,
              SUM(sm.weight_delta)::text   AS poids,
              SUM(sm.cbm_delta)::text      AS cbm
         FROM stock_movements sm
        WHERE ${RANGE_SQL('sm.created_at', 1, 2, 3)}
        GROUP BY sm.office, sm.reason ORDER BY sm.office, sm.reason`,
      p
    ),
    // Un état, pas un flux : ce qui est en route AUJOURD'HUI.
    db.query(
      `SELECT COUNT(*)::int AS bons,
              COALESCE(SUM(bl.quantity), 0)::text  AS quantite,
              COALESCE(SUM(bl.weight_kg), 0)::text AS poids,
              COALESCE(SUM(bl.cbm), 0)::text       AS cbm
         FROM bons b LEFT JOIN bon_lines bl ON bl.bon_id = b.id
        WHERE b.order_id IS NULL AND b.status = 'en_transit'`
    ),
  ]);

  return {
    ...head('goods', range, { dateBy }),
    parStatut: parStatut.rows,
    articles: articles.rows,
    mouvements: mouvements.rows,
    enTransit: enTransit.rows[0],
  };
}
