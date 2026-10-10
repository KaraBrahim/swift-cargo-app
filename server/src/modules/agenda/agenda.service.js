// L'agenda : qui vient au bureau, quel jour, et pourquoi.
//
// Les dates sont l'organe central du métier : un passager atterrit à Alger le 14,
// et ce jour-là des gens viennent récupérer leur marchandise ; un fournisseur
// doit passer prendre la sienne le 16. Cette page répond à une seule question —
// « combien de personnes, et lesquelles, un jour donné ? » — à partir des dates
// déjà portées par les bons et les ordres. Rien n'est stocké ici : tout se lit.
import { getPool } from '../../db/pool.js';
import { errors } from '../../lib/AppError.js';
import { parseDay } from '../../lib/calendar.js';

const day = (col) => `to_char(${col}, 'YYYY-MM-DD')`;

// Un bon passager qui doit arriver (ou part) dans l'intervalle.
const BON_COLS = (today) => `
  b.id, b.reference, b.status, b.airport, b.airport_wilaya, b.airline,
  p.name AS passager_name, p.phone AS passager_phone,
  ${day('b.departure_planned_on')} AS departure_planned_on,
  ${day('b.departure_actual_on')}  AS departure_actual_on,
  ${day('b.arrival_promised_on')}  AS arrival_promised_on,
  ${day('b.arrival_actual_on')}    AS arrival_actual_on,
  CASE WHEN b.status IN ('cree','en_transit') AND b.arrival_promised_on < ${today}
       THEN ${today} - b.arrival_promised_on END AS days_overdue,
  (SELECT COALESCE(SUM(l.quantity), 0)::numeric(16,3) FROM bon_lines l WHERE l.bon_id = b.id) AS quantity,
  (SELECT COALESCE(SUM(l.weight_kg), 0)::numeric(16,3) FROM bon_lines l WHERE l.bon_id = b.id) AS weight_kg,
  (SELECT string_agg(DISTINCT sf.name, ', ' ORDER BY sf.name)
     FROM bon_lines l JOIN bon_lines src ON src.id = l.source_line_id
     JOIN bons sb ON sb.id = src.bon_id JOIN people sf ON sf.id = sb.fournisseur_id
    WHERE l.bon_id = b.id) AS fournisseurs`;

export async function agenda({ from, to, today } = {}) {
  const f = parseDay(from, 'from');
  const t = parseDay(to, 'to');
  if (!f || !t) throw errors.validation([{ field: 'from', message: 'from et to sont obligatoires (AAAA-MM-JJ).' }]);
  if (t < f) throw errors.validation([{ field: 'to', message: 'La fin ne peut pas précéder le début.' }]);
  const span = (new Date(`${t}T00:00:00Z`) - new Date(`${f}T00:00:00Z`)) / 86_400_000;
  if (span > 366) throw errors.validation([{ field: 'to', message: 'Au plus un an à la fois.' }]);

  // « Aujourd'hui » est le jour de la personne qui regarde, pas celui du serveur :
  // à Alger, une heure après minuit, la base (en UTC) croit encore à hier.
  const now = parseDay(today, 'today');
  const todayExpr = now ? '$3::date' : 'CURRENT_DATE';   // requêtes à deux bornes
  const todayAlone = now ? '$1::date' : 'CURRENT_DATE';  // requête sans bornes
  const extra = now ? [now] : [];
  const db = getPool();

  const [arrivals, departures, pickups, overdue] = await Promise.all([
    db.query(
      `SELECT ${BON_COLS(todayExpr)} FROM bons b LEFT JOIN people p ON p.id = b.passager_id
        WHERE b.order_id IS NULL AND b.arrival_promised_on BETWEEN $1 AND $2
        ORDER BY b.arrival_promised_on, b.id`, [f, t, ...extra]),
    db.query(
      `SELECT ${BON_COLS(todayExpr)} FROM bons b LEFT JOIN people p ON p.id = b.passager_id
        WHERE b.order_id IS NULL AND b.departure_planned_on BETWEEN $1 AND $2
        ORDER BY b.departure_planned_on, b.id`, [f, t, ...extra]),
    db.query(
      `SELECT o.id, o.reference, o.status, fo.name AS fournisseur_name, fo.phone AS fournisseur_phone,
              ${day('o.pickup_expected_on')} AS pickup_expected_on,
              (SELECT string_agg(DISTINCT bl.designation, ', ' ORDER BY bl.designation)
                 FROM bon_lines bl JOIN bons b ON b.id = bl.bon_id WHERE b.order_id = o.id) AS goods
         FROM orders o JOIN people fo ON fo.id = o.fournisseur_id
        WHERE o.pickup_expected_on BETWEEN $1 AND $2
        ORDER BY o.pickup_expected_on, o.id`, [f, t]),
    // Les retards ne dépendent pas de l'intervalle regardé : un bon qui devait
    // arriver il y a trois jours reste à surveiller, quelle que soit la semaine.
    db.query(
      `SELECT ${BON_COLS(todayAlone)} FROM bons b LEFT JOIN people p ON p.id = b.passager_id
        WHERE b.order_id IS NULL AND b.status IN ('cree','en_transit')
          AND b.arrival_promised_on < ${todayAlone}
        ORDER BY b.arrival_promised_on, b.id`, now ? [now] : []),
  ]);

  // Regroupé par jour — tous les jours de l'intervalle, même vides : une
  // semaine où rien n'arrive est une réponse.
  const days = new Map();
  for (let d = new Date(`${f}T00:00:00Z`); d <= new Date(`${t}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    days.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), arrivals: [], departures: [], pickups: [] });
  }
  for (const r of arrivals.rows) days.get(r.arrival_promised_on)?.arrivals.push(r);
  for (const r of departures.rows) days.get(r.departure_planned_on)?.departures.push(r);
  for (const r of pickups.rows) days.get(r.pickup_expected_on)?.pickups.push(r);

  return {
    from: f, to: t,
    days: [...days.values()],
    overdue: overdue.rows,
    counts: { arrivals: arrivals.rowCount, departures: departures.rowCount, pickups: pickups.rowCount, overdue: overdue.rowCount },
  };
}

const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

// Le résumé du tableau de bord : aujourd'hui, demain, et ce qui est en retard.
export async function agendaSummary({ today } = {}) {
  const now = parseDay(today, 'today')
    ?? (await getPool().query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")).rows[0].d;
  const tomorrow = addDays(now, 1);
  const a = await agenda({ from: now, to: tomorrow, today: now });
  const [d0, d1] = a.days;
  const side = (d) => ({
    date: d.date,
    arrivals: d.arrivals.length, departures: d.departures.length, pickups: d.pickups.length,
    items: { arrivals: d.arrivals, departures: d.departures, pickups: d.pickups },
  });
  return {
    today: side(d0),
    tomorrow: side(d1),
    overdue: a.overdue,
    counts: a.counts,
  };
}
