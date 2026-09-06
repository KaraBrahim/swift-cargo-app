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
export default function AmountInput({
  value,
  onChange,
  decimals = 2,
  // Money always shows its centimes: an empty field reads 0.00 and typing 5
  // gives 5.00, because these amounts are read aloud as dinars AND centimes.
  // Quantities, weights and rates are not money — they ask for 3 or 6 decimals
  // and keep a bare 12.5 — so the rule follows the scale rather than needing a
  // second prop that a call site could forget to pass.
  money = decimals === 2,
  ...rest
}) {
  const empty = value === '' || value == null;
  return (
    <NumericFormat
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
}
