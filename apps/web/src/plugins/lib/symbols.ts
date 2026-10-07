/**
 * Math symbol table for `api.latex.symbols()`: prefers @texit/core's
 * `mathSymbols` (whatever its exact shape), falling back to the table shipped
 * with codemirror-lang-latex, grouped into categories.
 */
import * as core from '@texit/core';
import { mathSymbols as cmSymbols } from 'codemirror-lang-latex';
import type { MathSymbolInfo } from '@texit/plugin-api';

/** First symbol of each contiguous group in codemirror-lang-latex's table. */
const GROUP_STARTS: Record<string, string> = {
  '\\alpha': 'Greek',
  '\\pm': 'Operators',
  '\\sum': 'Big operators',
  '\\leq': 'Relations',
  '\\lesssim': 'Relations',
  '\\leftarrow': 'Arrows',
  '\\twoheadrightarrow': 'Arrows',
  '\\langle': 'Delimiters',
  '\\lvert': 'Delimiters',
  '\\ldots': 'Dots',
  '\\infty': 'Misc',
  '\\nexists': 'Misc',
  '\\sin': 'Functions',
};

function asCommand(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  return v.startsWith('\\') ? v : `\\${v}`;
}

/** Normalise an unknown symbol record shape into MathSymbolInfo. */
function normalize(raw: any, category?: string): MathSymbolInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const command = asCommand(raw.command ?? raw.cmd ?? raw.latex ?? raw.insert ?? raw.name);
  if (!command) return null;
  const glyph = raw.glyph ?? raw.unicode ?? raw.char ?? raw.symbol;
  return {
    command,
    glyph: typeof glyph === 'string' ? glyph : undefined,
    category: String(raw.category ?? raw.group ?? category ?? 'Misc'),
    package: typeof raw.package === 'string' ? raw.package : undefined,
    name: typeof raw.description === 'string' ? raw.description : typeof raw.title === 'string' ? raw.title : undefined,
  };
}

function fromCore(): MathSymbolInfo[] | null {
  const src = (core as Record<string, unknown>)['mathSymbols'];
  if (!src) return null;
  const out: MathSymbolInfo[] = [];
  if (Array.isArray(src)) {
    for (const s of src) {
      const n = normalize(s);
      if (n) out.push(n);
    }
  } else if (typeof src === 'object') {
    for (const [cat, list] of Object.entries(src as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        const n = normalize(s, cat);
        if (n) out.push(n);
      }
    }
  }
  return out.length ? out : null;
}

function fromCodeMirror(): MathSymbolInfo[] {
  let category = 'Misc';
  return cmSymbols.map((s) => {
    category = GROUP_STARTS[s.name] ?? category;
    return { command: s.name, glyph: s.glyph, category, package: s.package };
  });
}

let cache: MathSymbolInfo[] | null = null;
let cacheFromCore = false;

export function getMathSymbols(): MathSymbolInfo[] {
  // Re-check core until it provides symbols (it may land after startup during development).
  if (cache && cacheFromCore) return cache;
  let fromC: MathSymbolInfo[] | null = null;
  try {
    fromC = fromCore();
  } catch {
    fromC = null;
  }
  if (fromC) {
    cache = fromC;
    cacheFromCore = true;
    return cache;
  }
  cache ??= fromCodeMirror();
  return cache;
}
