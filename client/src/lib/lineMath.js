// L'arithmétique d'une ligne de bon, côté écran — le miroir de
// server/src/lib/lineMath.js. Le serveur reste seul juge ; ces fonctions ne
// servent qu'à montrer, avant l'envoi, ce que le serveur calculera.
//
// Une ligne porte TOUJOURS une quantité et un poids. `measure` ne dit qu'une
// chose : le prix unitaire s'applique à la quantité ('quantite') ou au poids
// ('poids'). Le suivi (confié, arrivé, manquant, remis) se compte en QUANTITÉ ;
// le poids d'une partie se déduit au prorata.
const n = (v) => Number(v) || 0;

// Le nombre par lequel le prix unitaire se multiplie, pour la ligne entière.
export const priceBasis = (l) => (l.measure === 'poids' ? n(l.weight_kg) : n(l.quantity));

// Le poids de `pieces` unités de la ligne : sa part du poids total (au gramme).
export const weightShare = (l, pieces) => (n(l.quantity) > 0
  ? Math.round((n(l.weight_kg) * n(pieces) / n(l.quantity)) * 1000) / 1000
  : 0);

// Ce par quoi multiplier le prix unitaire pour `pieces` unités de la ligne.
export const pricedPart = (l, pieces) => (l.measure === 'poids' ? weightShare(l, pieces) : n(pieces));

// Le prix d'UNE pièce, à partir d'un prix qui s'applique à la mesure de la ligne.
export const perPiece = (l, price) => (l.measure === 'poids'
  ? (n(l.quantity) > 0 ? n(price) * n(l.weight_kg) / n(l.quantity) : 0)
  : n(price));

// L'inverse : le prix par unité de MESURE, à partir d'un prix par pièce.
export const perMeasureUnit = (l, pricePerPiece) => (l.measure === 'poids'
  ? (n(l.weight_kg) > 0 ? n(pricePerPiece) * n(l.quantity) / n(l.weight_kg) : 0)
  : n(pricePerPiece));

// L'unité du prix : « kg » quand on tarife au poids, sinon l'unité de la ligne.
export const priceUnit = (l) => (l.measure === 'poids' ? 'kg' : (l.unit || 'pièce'));
