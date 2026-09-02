// Zero-dependency VS Code-style fuzzy matcher: the query must be a case-insensitive
// SUBSEQUENCE of the target (letters in order, gaps allowed), scored so the best
// matches float to the top. Bonuses for consecutive runs, matches at word starts /
// after separators, and an exact prefix; small penalty per gap. Accent-insensitive
// so "cafe" matches "Café".

const deburr = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => deburr(String(s ?? '')).toLowerCase();
const isSep = (ch) => ch === ' ' || ch === '-' || ch === '_' || ch === '/' || ch === '.' || ch === ',';

// Returns a score (higher = better) or null when `query` is not a subsequence.
export function fuzzyScore(query, target) {
  const q = norm(query);
  const t = norm(target);
  if (!q) return 0;
  if (q.length > t.length) return null;

  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  let runLength = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      if (prevMatch === ti - 1) { runLength += 1; bonus += 4 + runLength * 2; } // consecutive run
      else { runLength = 0; }
      if (ti === 0) bonus += 8;                       // matches very start
      else if (isSep(t[ti - 1])) bonus += 6;          // matches a word start
      score += bonus;
      prevMatch = ti;
      qi += 1;
    } else {
      score -= 1; // small gap penalty
    }
  }

  if (qi < q.length) return null;                     // not a full subsequence
  if (t.startsWith(q)) score += 12;                   // exact prefix boost
  if (t === q) score += 30;                           // exact match
  score -= Math.max(0, t.length - q.length) * 0.1;    // gently prefer shorter targets
  return score;
}

// Rank a list against the query. Empty query → the first `limit` items unchanged.
export function fuzzyRank(query, list, keyFn = (x) => x, limit = 8) {
  if (!query || !query.trim()) return list.slice(0, limit);
  const scored = [];
  for (const item of list) {
    const s = fuzzyScore(query, keyFn(item));
    if (s !== null) scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.item);
}

// True when any item's key equals the query (case/accent-insensitive) — used to
// decide whether to offer "create new".
export function hasExact(query, list, keyFn = (x) => x) {
  const q = norm(query);
  return list.some((x) => norm(keyFn(x)) === q);
}
