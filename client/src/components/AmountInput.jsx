import { NumericFormat } from 'react-number-format';
import { GROUP_SEPARATOR, DECIMAL_SEPARATOR } from '../lib/format.js';

// A money field that groups digits as you type: 1 000 000 can no longer be
// misread as 100 000. The mistake this prevents is a factor of ten on a cash
// movement, which is the kind of error a ledger does not forgive.
//
// Nothing but digits gets in — letters, spaces and punctuation are dropped as
// they are typed or pasted, so the value can never reach the API as text.
//
// The separators come from lib/format.js, the same ones the totals and the
// printed receipt use, so what you type looks like what is shown back.
// Une quantité se corrige d'une unité à la fois — un carton de plus, un de
// moins — et retaper le nombre entier pour passer de 12 à 13 est le geste qu'on
// répète cinquante fois par jour. `step` ajoute donc « − » et « + » de part et
// d'autre du champ, et les flèches Haut / Bas du clavier font la même chose
// sans quitter la saisie.
//
// Réservé aux quantités, pas aux montants : monter un prix de 45 000 DA d'un
// dinar à la fois n'a aucun sens, et deux boutons inutiles à côté de chaque
// somme d'argent ne feraient qu'encombrer. C'est pourquoi ça s'active en
// passant `step`, plutôt que tout seul.
//
// `max` sert autant que les boutons : quand on sait ce qui est disponible — le
// reste d'un lot, ce qui est arrivé au bureau — le pas s'y arrête. L'erreur est
// alors impossible à commettre au lieu d'être refusée après coup.
export default function AmountInput({
  value,
  onChange,
  decimals = 2,
  // Money always shows its centimes: an empty field reads 0.00 and typing 5
  // gives 5.00, because these amounts are read aloud as dinars AND centimes.
  // Quantities, weights and rates are not money — they ask for 3 or 6 decimals
  // and keep a bare 12.5 — so the rule follows the scale rather than needing a
  // second prop that a call site could forget to pass.
  //
  // Conséquence à connaître : un champ d'ARGENT n'affiche jamais son
  // `placeholder`, puisqu'il n'est jamais vide — il montre « 0.00 ». Pour
  // proposer un montant, il faut donc passer une VALEUR, pas un placeholder.
  // Trois écrans proposaient ainsi un montant que personne ne voyait, et qu'il
  // fallait retaper à la main. (Un champ de QUANTITÉ, lui, reste vide et
  // affiche bien le sien.)
  money = decimals === 2,
  step,
  min = 0,
  max,
  className,
  onKeyDown,
  ...rest
}) {
  const empty = value === '' || value == null;
  const size = Number(step);
  const stepped = Number.isFinite(size) && size > 0;

  const num = Number(value);
  const current = Number.isFinite(num) ? num : 0;
  const lo = min == null ? null : Number(min);
  const hi = max == null || max === '' ? null : Number(max);

  const bump = (dir) => {
    let next = current + dir * size;
    // Le flottant : 0.1 + 0.2 vaut 0.30000000000000004, et un champ de
    // quantité n'a pas à montrer ça. On arrondit à l'échelle du champ, puis on
    // laisse tomber les zéros de queue — « 41 », pas « 41.000 ».
    next = Number(next.toFixed(decimals));
    if (lo != null && next < lo) next = lo;
    if (hi != null && next > hi) next = hi;
    onChange(String(next));
  };

  const field = (
    <NumericFormat
      className={className}
      onKeyDown={(e) => {
        if (stepped && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          // Sinon le curseur saute au début ou à la fin du nombre.
          e.preventDefault();
          bump(e.key === 'ArrowUp' ? 1 : -1);
        }
        onKeyDown?.(e);
      }}
      value={money && empty ? '0' : (value ?? '')}
      thousandSeparator={GROUP_SEPARATOR}
      decimalSeparator={DECIMAL_SEPARATOR}
      // A French keyboard's numeric pad gives a comma; it means "decimals here"
      // and is turned into the dot. The old inputs did this with .replace().
      allowedDecimalSeparators={[',', '.']}
      decimalScale={decimals}
      fixedDecimalScale={money}
      allowNegative={false}
      inputMode="decimal"
      autoComplete="off"
      // Without this, clicking a field showing 0.00 and typing 5 leaves the
      // caret after the zero and produces 0.005. Selecting on focus makes the
      // first keystroke replace the amount, which is what everyone expects of a
      // field that is already filled in.
      onFocus={(e) => e.target.select()}
      onValueChange={(v, info) => {
        // Fires on programmatic changes too — reacting to those would fight the
        // parent's own state (a reset to '' would bounce straight back).
        if (info.source === 'event') onChange(v.value);
      }}
      {...rest}
    />
  );

  if (!stepped) return field;

  // tabIndex={-1} : la tabulation traverse le formulaire champ par champ. Trois
  // arrêts par quantité au lieu d'un, alors que les flèches font déjà le travail
  // sans lâcher le clavier.
  const arrow = (dir, label, sign) => (
    <button
      type="button"
      className="qty-btn"
      tabIndex={-1}
      disabled={dir < 0 ? (lo != null && current <= lo) : (hi != null && current >= hi)}
      onClick={() => bump(dir)}
      aria-label={label}
      title={`${label} (flèche ${dir > 0 ? 'haut' : 'bas'})`}
    >
      {sign}
    </button>
  );

  return (
    <span className="qty-field">
      {arrow(-1, 'Diminuer', '−')}
      {field}
      {arrow(1, 'Augmenter', '+')}
    </span>
  );
}
