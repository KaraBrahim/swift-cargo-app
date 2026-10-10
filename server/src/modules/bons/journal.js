// Le journal d'un bon passager : ce qui lui est arrivé, dans l'ordre.
//
//   créé → parti (au jour réel) → arrivé (au jour réel, avec ses jours de retard)
//   → manquants constatés, ligne par ligne → réglé → paiements
//
// Pur : il relit ce que la fiche a déjà chargé (le bon, ses lignes, son
// historique de statuts, ses paiements) et ne touche pas à la base.
import { Decimal } from '../../lib/money.js';

const D = (v) => new Decimal(v ?? 0);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const ORDER = { created: 0, departed: 1, arrived: 2, missing: 3, settled: 4, payment: 5 };

const lastOf = (history, status) => [...history].reverse().find((h) => h.status === status) ?? null;

export function bonJournal({ bon, lines, history = [], payments = [] }) {
  const events = [];
  const total = (f) => lines.reduce((a, l) => a.plus(D(l[f])), D(0));
  const base = { quantity: null, weight_kg: null, actor: null, note: null, day: null };

  events.push({
    ...base, kind: 'created', at: iso(bon.created_at), actor: bon.created_by_name ?? null,
    quantity: total('quantity').toFixed(3), weight_kg: total('weight_kg').toFixed(3),
    note: `${lines.length} ligne${lines.length > 1 ? 's' : ''}`,
  });

  const stages = ['en_transit', 'arrive', 'regle'];
  const reached = (s) => stages.indexOf(bon.status) >= stages.indexOf(s);

  const left = reached('en_transit') ? lastOf(history, 'en_transit') : null;
  if (left) {
    events.push({
      ...base, kind: 'departed', at: iso(left.created_at), actor: left.admin_name ?? null,
      day: bon.departure_actual_on ?? null, planned: bon.departure_planned_on ?? null,
      quantity: total('quantity').toFixed(3), weight_kg: total('weight_kg').toFixed(3),
    });
  }

  const there = reached('arrive') ? lastOf(history, 'arrive') : null;
  if (there) {
    const got = lines.reduce((a, l) => a.plus(l.received_quantity != null ? D(l.received_quantity) : D(l.quantity)), D(0));
    const of = total('quantity');
    events.push({
      ...base, kind: 'arrived', at: iso(there.created_at), actor: there.admin_name ?? null,
      day: bon.arrival_actual_on ?? null, promised: bon.arrival_promised_on ?? null,
      days_late: bon.days_late != null ? Number(bon.days_late) : null,
      quantity: got.toFixed(3), of: of.toFixed(3), missing: Decimal.max(of.minus(got), 0).toFixed(3),
    });
    // Un manquant se dit ligne par ligne : quoi, combien, de qui — et ce qu'il vaut.
    for (const l of lines) {
      if (l.received_quantity == null) continue;
      const miss = D(l.quantity).minus(D(l.received_quantity));
      if (miss.lte(0)) continue;
      events.push({
        ...base, kind: 'missing', at: iso(there.created_at), designation: l.designation, unit: l.unit,
        quantity: miss.toFixed(3), of: D(l.quantity).toFixed(3), note: l.responsible ?? null,
        loss_value: l.loss_value != null ? D(l.loss_value).toFixed(2) : null,
      });
    }
  }

  const settled = bon.status === 'regle' ? lastOf(history, 'regle') : null;
  if (settled) {
    events.push({
      ...base, kind: 'settled', at: iso(settled.created_at), actor: settled.admin_name ?? null,
      amount: bon.passager_payment != null ? D(bon.passager_payment).toFixed(2) : null, currency: bon.transport_currency,
    });
  }

  for (const p of payments) {
    events.push({
      ...base, kind: 'payment', at: iso(p.created_at), actor: p.admin_name ?? null,
      amount: D(p.amount).abs().toFixed(2), currency: p.currency_code, direction: p.type === 'fee_payment' ? 'in' : 'out',
      note: p.caisse_label ?? null,
    });
  }

  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : ORDER[a.kind] - ORDER[b.kind]));
}
