// Le journal de la marchandise d'un ordre : ce qui lui est arrivé, ligne par
// ligne, dans l'ordre où cela s'est passé.
//
//   reçue en Chine → confiée à un passager → partie → arrivée à Alger (avec ses
//   manquants) → remise au fournisseur (en une ou plusieurs fois) → remise annulée
//
// Rien n'est stocké à part : tout se relit sur ce qui existe déjà — les lignes
// des bons passagers qui tirent sur la ligne (confié, parti, arrivé), et les
// mouvements de stock de la remise. Chaque événement dit aussi OÙ en est la ligne
// APRÈS lui (en Chine, en route, à Alger, remis, manquant) : on lit l'histoire
// et l'état en même temps.
import { Decimal } from '../../lib/money.js';

const D = (v) => new Decimal(v ?? 0);
const iso = (v) => (v ? new Date(v).toISOString() : null);

// À heure égale, la vie d'une marchandise suit cet ordre.
const ORDER = { received: 0, allocated: 1, departed: 2, arrived: 3, delivered: 4, delivery_cancelled: 5 };

export async function orderJournal(client, order, lines) {
  if (!lines.length) return [];
  const ids = lines.map((l) => l.line_id);

  const [{ rows: kids }, { rows: moves }] = await Promise.all([
    client.query(
      `SELECT cl.source_line_id, cl.quantity, cl.weight_kg, cl.received_quantity, cl.responsible,
              cb.id AS bon_id, cb.reference, cb.status, cb.created_at, cb.arrived_at,
              to_char(cb.departure_actual_on, 'YYYY-MM-DD') AS departure_day,
              to_char(cb.arrival_actual_on,   'YYYY-MM-DD') AS arrival_day,
              p.name AS passager_name, a.full_name AS created_by_name,
              (SELECT h.created_at FROM bon_status_history h
                WHERE h.bon_id = cb.id AND h.status = 'en_transit' ORDER BY h.id DESC LIMIT 1) AS departed_at
         FROM bon_lines cl
         JOIN bons cb ON cb.id = cl.bon_id
         JOIN admins a ON a.id = cb.created_by
         LEFT JOIN people p ON p.id = cb.passager_id
        WHERE cl.source_line_id = ANY($1::bigint[])`, [ids]),
    client.query(
      `SELECT m.id, m.created_at, m.quantity_delta, m.weight_delta, m.reason, m.note, m.ref_line_id, m.item_id,
              a.full_name AS admin_name
         FROM stock_movements m LEFT JOIN admins a ON a.id = m.admin_id
        WHERE m.ref_order_id = $1
          AND (m.reason = 'livraison' OR (m.reason = 'ajustement' AND m.note LIKE 'Annulation livraison%'))
        ORDER BY m.created_at, m.id`, [order.id]),
  ]);

  const byId = new Map(lines.map((l) => [String(l.line_id), l]));
  // Un mouvement sait de quelle ligne il vient (ref_line_id) ; les plus anciens
  // non : on les rattache à la première ligne qui porte le même article.
  const lineOfMove = (m) => (m.ref_line_id != null && byId.get(String(m.ref_line_id)))
    || lines.find((l) => l.item_id != null && String(l.item_id) === String(m.item_id));

  const events = [];
  const push = (line, e) => events.push({
    line_id: line.line_id, designation: line.designation, unit: line.unit,
    quantity: null, weight_kg: null, actor: null, bon_id: null, bon_reference: null, person: null, note: null, day: null,
    ...e,
  });

  for (const l of lines) {
    push(l, {
      kind: 'received', at: iso(order.created_at), quantity: D(l.quantity).toFixed(3), weight_kg: D(l.weight_kg).toFixed(3),
      actor: order.created_by_name ?? null,
    });
  }

  for (const k of kids) {
    const line = byId.get(String(k.source_line_id));
    if (!line) continue;
    const base = { bon_id: k.bon_id, bon_reference: k.reference, person: k.passager_name ?? null };
    push(line, {
      ...base, kind: 'allocated', at: iso(k.created_at), actor: k.created_by_name,
      quantity: D(k.quantity).toFixed(3), weight_kg: D(k.weight_kg).toFixed(3),
    });
    if (['en_transit', 'arrive', 'regle'].includes(k.status) && k.departed_at) {
      push(line, {
        ...base, kind: 'departed', at: iso(k.departed_at), day: k.departure_day,
        quantity: D(k.quantity).toFixed(3), weight_kg: D(k.weight_kg).toFixed(3),
      });
    }
    if (['arrive', 'regle'].includes(k.status) && k.arrived_at) {
      const got = k.received_quantity != null ? D(k.received_quantity) : D(k.quantity);
      push(line, {
        ...base, kind: 'arrived', at: iso(k.arrived_at), day: k.arrival_day,
        quantity: got.toFixed(3), of: D(k.quantity).toFixed(3),
        missing: Decimal.max(D(k.quantity).minus(got), 0).toFixed(3),
        weight_kg: D(k.weight_kg).toFixed(3), note: k.responsible ?? null,
      });
    }
  }

  for (const m of moves) {
    const line = lineOfMove(m);
    if (!line) continue;
    const cancelled = m.reason === 'ajustement';
    push(line, {
      kind: cancelled ? 'delivery_cancelled' : 'delivered', at: iso(m.created_at), actor: m.admin_name ?? null,
      quantity: D(m.quantity_delta).abs().toFixed(3), weight_kg: D(m.weight_delta).abs().toFixed(3),
      note: cancelled ? null : (m.note ?? null),
    });
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : ORDER[a.kind] - ORDER[b.kind]));

  // Où en est chaque ligne APRÈS chaque événement.
  const state = new Map(lines.map((l) => [String(l.line_id), { china: D(0), transit: D(0), office: D(0), delivered: D(0), missing: D(0) }]));
  for (const e of events) {
    const s = state.get(String(e.line_id));
    const q = D(e.quantity);
    if (e.kind === 'received') s.china = s.china.plus(q);
    else if (e.kind === 'allocated') { s.china = s.china.minus(q); s.transit = s.transit.plus(q); }
    else if (e.kind === 'arrived') {
      s.transit = s.transit.minus(D(e.of));
      s.office = s.office.plus(q);
      s.missing = s.missing.plus(D(e.missing));
    } else if (e.kind === 'delivered') { s.office = s.office.minus(q); s.delivered = s.delivered.plus(q); }
    else if (e.kind === 'delivery_cancelled') { s.office = s.office.plus(q); s.delivered = s.delivered.minus(q); }
    e.after = Object.fromEntries(Object.entries(s).map(([key, v]) => [key, Decimal.max(v, 0).toFixed(3)]));
  }
  return events;
}
