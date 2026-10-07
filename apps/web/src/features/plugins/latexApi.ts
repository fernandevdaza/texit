/**
 * `api.latex` implementation: delegates to @texit/core and falls back to the
 * small local implementations while core's are unavailable ("not implemented").
 */
import * as core from '@texit/core';
import type { PluginAPI } from '@texit/plugin-api';
import { analyzeLatexFallback, countWordsFallback } from '@/plugins/lib/latexText';
import { parseBibtexFallback } from '@/plugins/lib/bibtex';
import { getMathSymbols } from '@/plugins/lib/symbols';

function tryCore<A extends unknown[], R>(name: string, fallback: (...a: A) => R): (...a: A) => R {
  return (...args: A) => {
    const fn = (core as Record<string, unknown>)[name];
    if (typeof fn === 'function') {
      try {
        return (fn as (...a: A) => R)(...args);
      } catch {
        // Core not implemented yet (or failed on this input) → fallback.
      }
    }
    return fallback(...args);
  };
}

export const latexApi: PluginAPI['latex'] = {
  analyze: tryCore('analyzeLatex', analyzeLatexFallback),
  countWords: tryCore('countWords', countWordsFallback),
  parseBibtex: tryCore('parseBibtex', parseBibtexFallback),
  symbols: () => getMathSymbols(),
};
