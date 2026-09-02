// The two currencies the business actually runs on: the Algeria desk works in
// dinars, the China desk in yuan. Everything else (USD, EUR, Alipay) is a
// sideline, so those two are shown larger and pre-selected — never forced: the
// user can always pick another currency.
export const OFFICE_CURRENCY = { china: 'CNY', algeria: 'DZD' };

export const MAIN_CURRENCIES = ['DZD', 'CNY'];

export const isMainCurrency = (code) => MAIN_CURRENCIES.includes(code);

// The currency a caisse should open on in forms. Falls back to DZD (the base
// currency) for a caisse that belongs to no office, e.g. a transit wallet.
export const defaultCurrencyFor = (office) => OFFICE_CURRENCY[office] || 'DZD';

// The currency shown large on a caisse. Only the two office caisses have one —
// anywhere else every balance stays the same small size, since no single
// currency is that wallet's working currency.
export const leadCurrencyFor = (office) => OFFICE_CURRENCY[office] ?? null;

// An office caisse leads with its own currency; everything else keeps the
// configured order. A caisse without an office is left untouched.
export function sortByImportance(codes, office) {
  const lead = leadCurrencyFor(office);
  if (!lead) return [...codes];
  return [...codes].sort((a, b) => (a === lead ? -1 : b === lead ? 1 : 0));
}
