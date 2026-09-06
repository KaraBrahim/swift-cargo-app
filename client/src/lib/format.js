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
