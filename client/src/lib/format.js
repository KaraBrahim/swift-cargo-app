// One way of writing a number, used by every screen, every input field and the
// printed receipt: digits grouped by a space, a DOT before the decimals, and no
// comma anywhere.
//
// Not toLocaleString('fr-FR'): that writes 1 234,56 — a comma — and groups with
// a NARROW no-break space (U+202F) that the thermal printer's code page cannot
// represent, so it prints as '?'. Doing the grouping here keeps the screen, the
// input fields and the paper identical.
export const GROUP_SEPARATOR = ' ';
export const DECIMAL_SEPARATOR = '.';

export function formatNumber(value, { decimals = 2, trim = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  let [int, dec = ''] = Math.abs(n).toFixed(decimals).split('.');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  if (trim) dec = dec.replace(/0+$/, '');           // 12.500 -> 12.5, 12.000 -> 12
  return `${n < 0 ? '-' : ''}${int}${dec ? DECIMAL_SEPARATOR + dec : ''}`;
}

// Money always keeps both decimals: a cash figure that renders as "8 000" and
// one that renders as "8 000.00" should not look like different kinds of thing.
export function formatMoney(value, code) {
  const n = Number(value);
  const s = Number.isFinite(n) ? formatNumber(n, { decimals: 2 }) : String(value);
  return code ? `${s} ${code}` : s;
}

// Quantities, weights and CBM: up to 3 decimals, trailing zeros dropped.
export const formatQty = (value) =>
  value == null ? '—' : formatNumber(value, { decimals: 3, trim: true });

// ── Dates ────────────────────────────────────────────────────────────
// Ce fichier ne parlait que de nombres ; les dates étaient écrites à la main,
// différemment, dans six écrans. Une plage de rapport doit se lire de la même
// façon à l'écran, sur le papier et dans un nom de fichier.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Une date ISO (AAAA-MM-JJ) découpée SANS passer par new Date() : construire
// un Date depuis « 2026-09-01 » le lit en UTC, et à Alger cela peut afficher
// le 31 août. Le texte est déjà le jour voulu — on ne fait que le relire.
const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};

// « 1er septembre 2026 ». L'année tombe quand elle est celle en cours et que
// l'appelant le demande — dans « du 1er au 8 septembre », la répéter deux fois
// n'apprend rien.
export function formatDateFr(iso, { year = true } = {}) {
  const p = parts(iso);
  if (!p) return String(iso ?? '—');
  const jour = p.d === 1 ? '1er' : String(p.d);
  return `${jour} ${MOIS[p.m - 1]}${year ? ` ${p.y}` : ''}`;
}

// « du 1er au 8 septembre 2026 », et ses cas particuliers : un seul jour se dit
// « le 8 septembre », un mois entier se dit « septembre 2026 ». Un intitulé qui
// répète le mois trois fois se lit moins bien qu'une phrase.
export function formatRangeFr(from, to) {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return '—';
  if (from === to) return `le ${formatDateFr(from)}`;
  const memeMois = a.y === b.y && a.m === b.m;
  if (memeMois && a.d === 1 && b.d === lastDayOf(a.y, a.m)) return `${MOIS[a.m - 1]} ${a.y}`;
  if (memeMois) return `du ${formatDateFr(from, { year: false })} au ${formatDateFr(to)}`;
  if (a.y === b.y) return `du ${formatDateFr(from, { year: false })} au ${formatDateFr(to)}`;
  return `du ${formatDateFr(from)} au ${formatDateFr(to)}`;
}

export const lastDayOf = (y, m) => new Date(y, m, 0).getDate();

// Le nombre de jours couverts, bornes comprises — ce que « 8 jours » veut dire
// quand on lit « du 1er au 8 ».
export function daysBetween(from, to) {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000) + 1;
}
