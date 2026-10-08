// Où en est la marchandise, en chiffres et en pourcentages.
//
// Un seul calcul, ici, pour tous les écrans : la liste, la fiche, le tableau de
// bord et le PDF disent la même chose parce qu'ils lisent la même fonction.
//
// Une quantité se répartit en tranches qui ne se chevauchent pas et dont la
// somme est le total — c'est ce qui permet de les empiler dans une seule barre :
//   ordre (bon fournisseur) : en Chine · confié, en route · manquant · à Alger · remis
//   bon passager            : à partir · en route · arrivé · manquant
//
// Les lignes n'ont pas toutes la même unité (des pièces, des kilos). On ne
// somme des quantités que si l'unité est commune ; sinon la barre porte des
// pourcentages (moyenne des lignes) et pas de quantité, plutôt qu'un total qui
// additionnerait des pièces et des kilos.
import { Decimal } from './money.js';

const D = (v) => new Decimal(v ?? 0);
const zero = (v) => Decimal.max(v, 0);

// La quantité d'une ligne, dans la mesure qui est la sienne (pièces ou kilos).
export const qtyOf = (l) => (l.measure === 'poids' ? D(l.weight_kg) : D(l.quantity));
export const unitOf = (l) => (l.measure === 'poids' ? 'kg' : (l.unit || 'pièce'));

const pct = (n, total) => (total.gt(0) ? Decimal.min(n.div(total).times(100), 100).toDecimalPlaces(1).toNumber() : 0);

// parts : [{ key, label, tone, of(l) → Decimal }]  ·  rows : les lignes
function stack(parts, rows, totalOf) {
  const per = rows.map((l) => ({ total: totalOf(l), seg: parts.map((p) => zero(p.of(l))) }));
  const units = new Set(rows.map(unitOf));
  const mixed = units.size > 1;
  const total = per.reduce((a, r) => a.plus(r.total), D(0));

  const segments = parts.map((p, i) => {
    const value = per.reduce((a, r) => a.plus(r.seg[i]), D(0));
    // Mélange d'unités : la moyenne des pourcentages de chaque ligne.
    const share = mixed
      ? (per.length ? per.reduce((a, r) => a + pct(r.seg[i], r.total), 0) / per.length : 0)
      : pct(value, total);
    return {
      key: p.key, label: p.label, tone: p.tone,
      value: mixed ? null : value.toFixed(3),
      pct: Math.round(share * 10) / 10,
    };
  });
  return { total: mixed ? null : total.toFixed(3), unit: mixed ? null : (rows[0] ? unitOf(rows[0]) : null), mixed, segments };
}

// ── Ordre : les lignes viennent de getOrderDetail (quantity, allocated,
// in_transit, missing, arrived, delivered_quantity).
const ORDER_PARTS = [
  { key: 'china',     label: 'En Chine',        tone: 'muted', of: (l) => D(l.quantity).minus(l.allocated) },
  { key: 'transit',   label: 'En route',        tone: 'gold',  of: (l) => D(l.in_transit) },
  { key: 'missing',   label: 'Manquant',        tone: 'red',   of: (l) => D(l.missing) },
  { key: 'office',    label: 'À Alger',         tone: 'blue',  of: (l) => D(l.arrived).minus(l.delivered_quantity) },
  { key: 'delivered', label: 'Remis',           tone: 'green', of: (l) => D(l.delivered_quantity) },
];

export function orderProgress(lines) {
  const p = stack(ORDER_PARTS, lines, (l) => D(l.quantity));
  // « Livré » au sens large : tout ce qui a quitté la Chine pour arriver.
  p.done_pct = Math.round((p.segments.find((s) => s.key === 'delivered').pct) * 10) / 10;
  return p;
}

// ── Bon passager : lignes brutes de bon_lines, et le statut du bon.
export function bonProgress(status, lines) {
  const arrived = status === 'arrive' || status === 'regle';
  const declared = qtyOf;
  const received = (l) => (arrived ? D(l.received_quantity ?? declared(l)) : D(0));
  const parts = [
    { key: 'waiting', label: 'À partir',  tone: 'muted', of: (l) => (status === 'cree' ? declared(l) : D(0)) },
    { key: 'transit', label: 'En route',  tone: 'gold',  of: (l) => (status === 'en_transit' ? declared(l) : D(0)) },
    { key: 'arrived', label: 'Arrivé',    tone: 'green', of: (l) => received(l) },
    { key: 'missing', label: 'Manquant',  tone: 'red',   of: (l) => (arrived ? declared(l).minus(received(l)) : D(0)) },
  ];
  return stack(parts, lines, declared);
}

// ── Argent : combien du dû est déjà réglé.
export function moneyProgress(due, paid) {
  const d = D(due), p = D(paid);
  return { due: d.toFixed(2), paid: p.toFixed(2), pct: pct(p, d), rest: Decimal.max(d.minus(p), 0).toFixed(2) };
}
