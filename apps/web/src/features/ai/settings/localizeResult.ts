/**
 * Localizes the English connection-test / provider messages produced by @texit/ai (and stored in
 * `ProviderEntry.lastTest`) at display time. Unknown text (e.g. a provider's own error body) is
 * returned unchanged.
 */
import { PROVIDER_PRESETS } from '@texit/ai';
import type { TFunction } from '@/lib/i18n';

const EXACT: Record<string, string> = {
  'Mock provider ready.': 'ai.test.mockReady',
  'Unavailable in production builds.': 'ai.test.mockUnavailable',
  'Not installed': 'ai.test.notInstalled',
  'Missing API key.': 'ai.test.missingKey',
  'A base URL is required.': 'ai.test.baseUrlRequired',
  'Unknown error': 'ai.test.unknownError',
  'CLI agents are tested through the desktop app (host.agents.detect()).': 'ai.test.cliViaDesktop',
  'The API key was rejected — check that it is correct and has access.': 'ai.hint.auth',
  'Endpoint not found — check the base URL.': 'ai.hint.notFound',
  'Rate limited or out of credits.': 'ai.hint.rateLimited',
  'The provider reported a server error; try again later.': 'ai.hint.serverError',
  'Network error — the server may be unreachable, or it does not allow requests from this origin (CORS).': 'ai.hint.network',
  'Network error — the server may be down, or it does not allow requests from this origin (CORS).': 'ai.hint.network',
};

const PATTERNS: [RegExp, (m: RegExpExecArray, t: TFunction) => string][] = [
  [/^Connected — (\d+) models? available\.$/, (m, t) => t('ai.test.connectedModels', { count: Number(m[1]) })],
  [/^Connected — (.+) responded \(model listing unavailable\)\.$/, (m, t) => t('ai.test.connectedResponded', { model: m[1] })],
  [/^Create one at (\S+)$/, (m, t) => t('ai.test.createAt', { url: m[1] })],
  [/^Could not reach (\S+): ([\s\S]*)$/, (m, t) => t('ai.test.couldNotReach', { origin: m[1], error: m[2] })],
  [/^(.+?) found$/, (m, t) => t('ai.test.found', { name: m[1].trim() })],
];

export function localizeProviderText(text: string | undefined, t: TFunction): string | undefined {
  if (!text) return text;
  const key = EXACT[text];
  if (key) return t(key);
  const preset = PROVIDER_PRESETS.find((p) => p.browserNote && p.browserNote === text);
  if (preset) return t(`ai.browserNote.${preset.kind}`, undefined, text);
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(text);
    if (m) return fn(m, t);
  }
  return text;
}

/** Browser/CORS note of a provider preset in the current language. */
export function browserNote(kind: string, english: string | undefined, t: TFunction): string | undefined {
  return english ? t(`ai.browserNote.${kind}`, undefined, english) : undefined;
}
