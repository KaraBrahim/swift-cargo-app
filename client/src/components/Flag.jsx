// Country flags as the emoji they are.
//
// The catch on Windows: Chrome ships no glyphs for regional-indicator pairs, so
// 🇩🇿 falls back to drawing the letters "DZ" — which is why these were hand-drawn
// SVGs before. `country-flag-emoji-polyfill` fixes exactly that and nothing
// else: a 78 KB woff2 holding only the flag glyphs, installed from main.jsx and
// only on the browsers that need it. Everywhere else the system emoji font is
// used and nothing is downloaded.
//
// The currency codes map to the country whose money it is; ALP is Alipay, which
// is Chinese money by another name.
const COUNTRY = {
  DZD: 'DZ', CNY: 'CN', ALP: 'CN', USD: 'US', EUR: 'EU',
  DZ: 'DZ', CN: 'CN', US: 'US', EU: 'EU',
};

// 'DZ' -> 🇩🇿 : each letter becomes its regional-indicator character.
const INDICATOR_A = 0x1f1e6;
const toEmoji = (cc) =>
  String.fromCodePoint(...[...cc].map((ch) => INDICATOR_A + ch.charCodeAt(0) - 65));

export default function Flag({ code, size = 18 }) {
  const cc = COUNTRY[code];
  if (!cc) return null;
  return (
    // Decoration: the country or currency is named right beside it.
    <span className="flag" style={{ fontSize: `${size}px` }} aria-hidden="true">
      {toEmoji(cc)}
    </span>
  );
}
