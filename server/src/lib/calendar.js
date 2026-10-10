// Les dates du calendrier — « le 14 octobre » — par opposition aux instants.
// (Les PLAGES de rapport et leur fuseau vivent dans lib/dates.js.)
//
// Une colonne DATE sort du pilote `pg` en objet Date à minuit HEURE LOCALE du
// serveur ; la sérialiser en JSON la ramène en UTC et la décale d'un jour
// partout à l'est de Greenwich. `ymd` la relit avec les getters locaux, ce qui
// redonne exactement le jour écrit en base, sur n'importe quelle machine.
import { errors } from './AppError.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

export function ymd(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

// Réécrit les colonnes DATE d'une ligne en « AAAA-MM-JJ ».
export function fixDates(row, cols) {
  for (const c of cols) if (c in row) row[c] = ymd(row[c]);
  return row;
}

// Une date saisie : « AAAA-MM-JJ », qui existe vraiment (pas le 31 avril), ou
// rien. Vide veut dire « effacer ».
export function parseDay(v, field = 'date') {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const t = new Date(`${s}T00:00:00Z`);
  const ok = DAY.test(s) && !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
  if (!ok) throw errors.validation([{ field, message: `${field} : date invalide (attendu AAAA-MM-JJ).` }]);
  return s;
}
