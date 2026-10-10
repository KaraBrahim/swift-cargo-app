// L'arithmétique d'une ligne de bon : quantité, poids, et par quoi on multiplie
// le prix.
//
// Une ligne porte TOUJOURS une quantité et un poids. `measure` ne dit qu'une
// chose : le prix unitaire s'applique à la quantité (`quantite`) ou au poids
// (`poids`). Tout le suivi — confié, arrivé, manquant, remis — se compte en
// QUANTITÉ ; le poids d'une partie se déduit au prorata. Une seule copie de
// ces règles, parce que le prix, le stock et la valeur d'un manquant doivent
// toujours dire la même chose de la même ligne.
import { Decimal } from './money.js';

const D = (v) => new Decimal(v ?? 0);

// Le nombre par lequel le prix unitaire se multiplie, pour la ligne entière.
export function priceBasis(l) {
  return l.measure === 'poids' ? D(l.weight_kg) : D(l.quantity);
}

// Le poids de `pieces` unités de cette ligne : sa part du poids total.
// Arrondi au gramme, la précision de la base.
export function weightShare(l, pieces) {
  const q = D(l.quantity);
  if (q.lte(0)) return new Decimal(0);
  return D(l.weight_kg).times(D(pieces)).div(q).toDecimalPlaces(3);
}

// Ce par quoi multiplier le prix unitaire pour `pieces` unités de la ligne :
// ces unités elles-mêmes, ou leur poids.
export function pricedPart(l, pieces) {
  return l.measure === 'poids' ? weightShare(l, pieces) : D(pieces);
}

// Le prix d'UNE unité (une pièce) de la ligne, à partir d'un prix qui
// s'applique à sa mesure. Sert à passer d'une ligne tarifée au poids à une
// ligne tarifée à la pièce — par exemple pour la valeur d'un manquant.
export function perPiece(l, price) {
  const q = D(l.quantity);
  if (l.measure !== 'poids') return D(price);
  return q.gt(0) ? D(price).times(D(l.weight_kg)).div(q) : new Decimal(0);
}

// L'inverse : le prix par unité de MESURE, à partir d'un prix par pièce.
export function perMeasureUnit(l, pricePerPiece) {
  if (l.measure !== 'poids') return D(pricePerPiece);
  const w = D(l.weight_kg);
  return w.gt(0) ? D(pricePerPiece).times(D(l.quantity)).div(w) : new Decimal(0);
}
