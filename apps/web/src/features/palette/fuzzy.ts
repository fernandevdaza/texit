/**
 * Small fzy-style fuzzy matcher with match positions (for highlighting).
 *
 *   fuzzy('mt', 'main.tex')        → { score, positions: [0, 5] }
 *   fuzzyPath('intro', 'chapters/intro.tex') prefers basename matches.
 *   fuzzyWords('side tog', 'Toggle sidebar') matches every word independently.
 */

export interface FuzzyResult {
  score: number;
  positions: number[];
}

const GAP_LEADING = -0.005;
const GAP_TRAILING = -0.005;
const GAP_INNER = -0.01;
const MATCH_CONSECUTIVE = 1.0;
const MATCH_SLASH = 0.9;
const MATCH_WORD = 0.8;
const MATCH_CAPITAL = 0.7;
const MATCH_DOT = 0.6;
const MAX_LEN = 256;

function bonusFor(prev: string, ch: string): number {
  if (prev === '/' || prev === '\\') return MATCH_SLASH;
  if (prev === '-' || prev === '_' || prev === ' ' || prev === ':' || prev === '(' || prev === '{') return MATCH_WORD;
  if (prev === '.') return MATCH_DOT;
  if (prev.toLowerCase() === prev && ch.toUpperCase() === ch && ch.toLowerCase() !== ch) return MATCH_CAPITAL;
  return 0;
}

/** Fuzzy-match `query` against `text` (case-insensitive). Returns null when not a subsequence. */
export function fuzzy(query: string, text: string): FuzzyResult | null {
  const n = query.length;
  const m = text.length;
  if (!n) return { score: 0, positions: [] };
  if (n > m || m > MAX_LEN * 4) return null;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Quick subsequence check.
  let qi = 0;
  for (let i = 0; i < m && qi < n; i++) if (t[i] === q[qi]) qi++;
  if (qi < n) return null;

  if (n === m) return { score: 1000, positions: Array.from({ length: n }, (_, i) => i) };
  if (m > MAX_LEN) {
    // Too long for the DP: greedy positions, low score.
    const positions: number[] = [];
    qi = 0;
    for (let i = 0; i < m && qi < n; i++) if (t[i] === q[qi]) (positions.push(i), qi++);
    return { score: -1, positions };
  }

  const bonus = new Float64Array(m);
  let prev = '/';
  for (let i = 0; i < m; i++) {
    bonus[i] = bonusFor(prev, text[i]!);
    prev = text[i]!;
  }

  // D[i][j]: best score ending with q[i] matched at t[j]; M[i][j]: best score of q[0..i] within t[0..j].
  const D: Float64Array[] = [];
  const M: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const Di = new Float64Array(m);
    const Mi = new Float64Array(m);
    let prevScore = -Infinity;
    const gap = i === n - 1 ? GAP_TRAILING : GAP_INNER;
    for (let j = 0; j < m; j++) {
      if (q[i] === t[j]) {
        let score = -Infinity;
        if (i === 0) score = j * GAP_LEADING + bonus[j]!;
        else if (j > 0) score = Math.max(M[i - 1]![j - 1]! + bonus[j]!, D[i - 1]![j - 1]! + MATCH_CONSECUTIVE);
        Di[j] = score;
        Mi[j] = prevScore = Math.max(score, prevScore + gap);
      } else {
        Di[j] = -Infinity;
        Mi[j] = prevScore = prevScore + gap;
      }
    }
    D.push(Di);
    M.push(Mi);
  }

  // Backtrack.
  const positions = new Array<number>(n);
  let matchRequired = false;
  for (let i = n - 1, j = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i]![j] !== -Infinity && (matchRequired || D[i]![j] === M[i]![j])) {
        matchRequired = i > 0 && j > 0 && M[i]![j] === D[i - 1]![j - 1]! + MATCH_CONSECUTIVE;
        positions[i] = j--;
        break;
      }
    }
  }
  return { score: M[n - 1]![m - 1]!, positions };
}

/** Every whitespace-separated word must match (in any order). */
export function fuzzyWords(query: string, text: string): FuzzyResult | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, positions: [] };
  if (words.length === 1) {
    const r = fuzzy(words[0]!, text);
    if (!r) return null;
    // Bonus for prefix / substring matches.
    const lt = text.toLowerCase();
    const lw = words[0]!.toLowerCase();
    if (lt.startsWith(lw)) r.score += 2;
    else if (lt.includes(lw)) r.score += 1;
    return r;
  }
  let score = 0;
  const all = new Set<number>();
  for (const w of words) {
    const r = fuzzy(w, text);
    if (!r) return null;
    score += r.score;
    r.positions.forEach((p) => all.add(p));
  }
  return { score, positions: [...all].sort((a, b) => a - b) };
}

/** Path-aware matching: strongly prefers matches inside the file name. */
export function fuzzyPath(query: string, path: string): FuzzyResult | null {
  const q = query.replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const slash = path.lastIndexOf('/');
  const base = path.slice(slash + 1);
  const rb = fuzzy(q, base);
  if (rb) {
    const exactish = base.toLowerCase().startsWith(q.toLowerCase()) ? 3 : 0;
    return { score: rb.score + 4 + exactish - path.length * 0.001, positions: rb.positions.map((p) => p + slash + 1) };
  }
  const rp = fuzzy(q, path);
  if (!rp) return null;
  return { score: rp.score - path.length * 0.001, positions: rp.positions };
}
