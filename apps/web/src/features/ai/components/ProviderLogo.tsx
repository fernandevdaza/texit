/** Simple inline-SVG monograms for providers (no brand assets). */
import type { WebProviderKind } from '../store';

const styles: Record<string, { bg: string; fg?: string; text: string }> = {
  openai: { bg: '#10a37f', text: 'O' },
  anthropic: { bg: '#d97757', text: 'A' },
  google: { bg: 'url(#tx-g-gemini)', text: 'G' },
  openrouter: { bg: '#6467f2', text: 'OR' },
  groq: { bg: '#f55036', text: 'Gq' },
  deepseek: { bg: '#4d6bfe', text: 'DS' },
  mistral: { bg: '#fa520f', text: 'M' },
  xai: { bg: '#111114', text: 'x' },
  'openai-compatible': { bg: '#64748b', text: '{ }' },
  ollama: { bg: '#f4f4f5', fg: '#18181b', text: 'Ol' },
  lmstudio: { bg: '#4338ca', text: 'LM' },
  cli: { bg: '#27272a', text: '>_' },
  'dev-mock': { bg: '#a855f7', text: 'Dev' },
  codex: { bg: '#10a37f', text: '>_' },
  claude: { bg: '#d97757', text: '>_' },
  gemini: { bg: 'url(#tx-g-gemini)', text: '>_' },
  opencode: { bg: '#27272a', text: 'oc' },
};

export function ProviderLogo({ kind, cliAgent, size = 28 }: { kind: WebProviderKind | string; cliAgent?: string; size?: number }) {
  const s = styles[kind === 'cli' && cliAgent ? cliAgent : kind] ?? { bg: '#71717a', text: String(kind).slice(0, 2).toUpperCase() };
  const fontSize = s.text.length > 2 ? 9 : s.text.length > 1 ? 11 : 14;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="tx-g-gemini" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset="0.55" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={s.bg} stroke={kind === 'ollama' ? 'rgb(0 0 0 / .12)' : 'none'} />
      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill={s.fg ?? '#fff'}
        fontFamily="Inter Variable, ui-sans-serif, system-ui"
        fontWeight={700}
        fontSize={fontSize}
        letterSpacing={s.text.length > 1 ? -0.3 : 0}
      >
        {s.text}
      </text>
    </svg>
  );
}
