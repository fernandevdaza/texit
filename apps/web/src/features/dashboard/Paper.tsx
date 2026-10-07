/**
 * Miniature "typeset" page used by project covers, template cards and the hero.
 * Sizes use container-query units (cqw) so the page scales with its width.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { DocPreview } from './preview';

const SERIF = 'KaTeX_Main, "Latin Modern Roman", "Computer Modern Serif", "Iowan Old Style", Georgia, serif';
const INK = '#16161a';
const BAR = '#dcdce3';

function Bars({ widths, h = 1.5, gap = 1.6, color = BAR, center }: { widths: number[]; h?: number; gap?: number; color?: string; center?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: `${gap}cqw`, alignItems: center ? 'center' : 'stretch' }}>
      {widths.map((w, i) => (
        <div key={i} style={{ height: `${h}cqw`, width: `${w}%`, background: color, borderRadius: '1cqw' }} />
      ))}
    </div>
  );
}

function Prose({ text, size = 2.7, lines = 7, indent = true }: { text?: string; size?: number; lines?: number; indent?: boolean }) {
  if (!text) return <Bars widths={[100, 97, 100, 92, 99, 64].slice(0, Math.max(2, Math.min(6, lines - 1)))} />;
  return (
    <p
      style={{
        fontSize: `${size}cqw`,
        lineHeight: 1.38,
        textAlign: 'justify',
        hyphens: 'auto',
        textIndent: indent ? `${size * 1.6}cqw` : undefined,
        color: '#2a2a31',
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {text}
    </p>
  );
}

function Sec({ n, children, size = 4 }: { n?: number | string; children: ReactNode; size?: number }) {
  return (
    <div style={{ fontSize: `${size}cqw`, fontWeight: 700, color: INK, margin: `${size * 1.1}cqw 0 ${size * 0.5}cqw`, display: 'flex', gap: `${size * 0.9}cqw`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {n != null && <span>{n}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </div>
  );
}

const clamp = (lines: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' });

export function paperAspect(kind: DocPreview['kind']) {
  return kind === 'slides' ? '16 / 10' : '1 / 1.414';
}

export function Paper({
  preview,
  fallbackTitle,
  thumbnail,
  accent = '#5b5bf0',
  className,
  style,
}: {
  preview?: DocPreview;
  fallbackTitle?: string;
  thumbnail?: string;
  accent?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const kind = preview?.kind ?? 'article';
  const title = (preview?.title && !/^untitled( document)?$/i.test(preview.title) ? preview.title : fallbackTitle) || preview?.title || 'Untitled';
  const sections = preview?.sections ?? [];
  const base: CSSProperties = {
    containerType: 'inline-size',
    aspectRatio: paperAspect(kind),
    fontFamily: SERIF,
    color: INK,
    background: '#fff',
    ...style,
  };

  if (thumbnail) {
    return (
      <div className={cn('overflow-hidden', className)} style={{ ...base, aspectRatio: undefined }}>
        <img src={thumbnail} alt="" draggable={false} className="block w-full" />
      </div>
    );
  }

  let body: ReactNode;
  if (kind === 'slides') {
    body = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, #111))`, padding: '7cqw 7cqw 6cqw', color: '#fff' }}>
          <div style={{ fontSize: '6.4cqw', lineHeight: 1.15, ...clamp(2) }}>{title}</div>
          {preview?.author && <div style={{ fontSize: '3.2cqw', opacity: 0.8, marginTop: '1.6cqw', ...clamp(1) }}>{preview.author}</div>}
        </div>
        <div style={{ padding: '5cqw 7cqw', display: 'flex', flexDirection: 'column', gap: '2.4cqw' }}>
          {(sections.length ? sections.slice(0, 3) : [null, null, null]).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2.4cqw' }}>
              <span style={{ width: '1.6cqw', height: '1.6cqw', borderRadius: 99, background: accent, flexShrink: 0 }} />
              {s ? <span style={{ fontSize: '3.4cqw', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</span> : <div style={{ height: '1.6cqw', width: `${70 - i * 12}%`, background: BAR, borderRadius: '1cqw' }} />}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'auto', padding: '0 4cqw 3cqw', textAlign: 'right', fontSize: '2.4cqw', color: '#888' }}>1 / {Math.max(8, sections.length + 4)}</div>
      </div>
    );
  } else if (kind === 'cv') {
    body = (
      <div style={{ padding: '10cqw 10cqw' }}>
        <div style={{ fontSize: '7.6cqw', fontWeight: 700, lineHeight: 1.1, ...clamp(2) }}>{title}</div>
        <div style={{ fontSize: '3cqw', color: '#666', marginTop: '1.6cqw' }}>{preview?.author || 'email@example.com · +1 555 0100'}</div>
        <div style={{ height: '0.6cqw', background: accent, margin: '4cqw 0 2cqw', borderRadius: 9 }} />
        {(sections.length ? sections.slice(0, 3) : ['Experience', 'Education', 'Skills']).map((s, i) => (
          <div key={i}>
            <div style={{ fontSize: '3.6cqw', color: accent, fontVariant: 'small-caps', letterSpacing: '0.02em', margin: '3.6cqw 0 1.8cqw' }}>{s}</div>
            <Bars widths={i === 0 ? [92, 70, 84] : [80, 60]} h={1.3} gap={1.5} />
          </div>
        ))}
      </div>
    );
  } else if (kind === 'letter') {
    body = (
      <div style={{ padding: '11cqw 11cqw', display: 'flex', flexDirection: 'column', gap: '3cqw' }}>
        <div style={{ alignSelf: 'flex-end', width: '38%' }}>
          <Bars widths={[100, 80, 66]} h={1.3} gap={1.3} />
        </div>
        <div style={{ width: '42%' }}>
          <Bars widths={[90, 100, 70]} h={1.3} gap={1.3} />
        </div>
        <div style={{ fontSize: '3cqw', marginTop: '3cqw' }}>Dear {preview?.author ? preview.author.split(' ')[0] : 'Sir or Madam'},</div>
        <Prose text={preview?.snippet} size={2.6} lines={6} />
        <Bars widths={[100, 94, 58]} />
        <div style={{ fontSize: '3cqw', marginTop: '2cqw' }}>Sincerely,</div>
        <div style={{ fontSize: '4.2cqw', fontStyle: 'italic', color: '#333' }}>{preview?.author || title}</div>
      </div>
    );
  } else if (kind === 'poster') {
    body = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: accent, color: '#fff', padding: '5cqw 6cqw', textAlign: 'center' }}>
          <div style={{ fontSize: '6cqw', fontWeight: 700, lineHeight: 1.1, ...clamp(2) }}>{title}</div>
          <div style={{ fontSize: '2.6cqw', opacity: 0.85, marginTop: '1.2cqw' }}>{preview?.author || 'Authors · Affiliation'}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3cqw', padding: '4cqw' }}>
          {[0, 1, 2].map((c) => (
            <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: '2.4cqw' }}>
              {[0, 1].map((b) => (
                <div key={b} style={{ border: `0.5cqw solid color-mix(in srgb, ${accent} 35%, white)`, borderRadius: '1.4cqw', padding: '2cqw' }}>
                  <div style={{ height: '1.8cqw', width: '60%', background: accent, opacity: 0.8, borderRadius: 9, marginBottom: '1.6cqw' }} />
                  <Bars widths={[100, 90, 96, 70]} h={1.1} gap={1.1} />
                  {c === 1 && b === 0 && <div style={{ marginTop: '1.6cqw', height: '12cqw', borderRadius: '1cqw', background: `color-mix(in srgb, ${accent} 18%, white)` }} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (kind === 'book') {
    body = (
      <div style={{ padding: '22cqw 12cqw 10cqw', textAlign: 'center' }}>
        <div style={{ fontSize: '8.4cqw', lineHeight: 1.15, ...clamp(3) }}>{title}</div>
        <div style={{ height: '0.4cqw', width: '30%', background: INK, margin: '6cqw auto' }} />
        <div style={{ fontSize: '3.8cqw', fontStyle: 'italic', color: '#333' }}>{preview?.author || 'A dissertation'}</div>
        <div style={{ marginTop: '20cqw' }}>
          <Bars widths={[50, 36]} center h={1.3} />
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ padding: '11cqw 12cqw' }}>
        <div style={{ fontSize: '6.6cqw', lineHeight: 1.2, textAlign: 'center', ...clamp(2) }}>{title}</div>
        <div style={{ fontSize: '3.3cqw', textAlign: 'center', marginTop: '2.6cqw', color: '#333', ...clamp(1) }}>{preview?.author || ' '}</div>
        {preview?.abstract && (
          <div style={{ margin: '4.6cqw 5cqw 0' }}>
            <div style={{ fontSize: '2.8cqw', fontWeight: 700, textAlign: 'center', marginBottom: '1.2cqw' }}>Abstract</div>
            <Prose text={preview.abstract} size={2.4} lines={4} indent={false} />
          </div>
        )}
        <Sec n={1}>{sections[0] ?? 'Introduction'}</Sec>
        <Prose text={preview?.snippet} lines={preview?.abstract ? 5 : 8} />
        {preview?.hasMath && (
          <div style={{ display: 'flex', alignItems: 'center', margin: '3cqw 0' }}>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div style={{ fontSize: '3.4cqw', fontStyle: 'italic' }}>
                f(x) = ∑ a<sub style={{ fontSize: '0.7em' }}>n</sub> x<sup style={{ fontSize: '0.7em' }}>n</sup>
              </div>
            </div>
            <span style={{ fontSize: '2.8cqw' }}>(1)</span>
          </div>
        )}
        <Sec n={2}>{sections[1] ?? 'Background'}</Sec>
        <Bars widths={[100, 96, 100, 88, 100, 72]} />
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden', className)} style={base}>
      {body}
    </div>
  );
}

// ───────────────────────────── cover palettes ─────────────────────────────

const pairs: [string, string][] = [
  ['#6366f1', '#a855f7'],
  ['#0ea5e9', '#6366f1'],
  ['#14b8a6', '#0ea5e9'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'],
  ['#22c55e', '#14b8a6'],
  ['#f97316', '#ec4899'],
  ['#8b5cf6', '#06b6d4'],
];

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function coverColors(id: string): [string, string] {
  return pairs[hashString(id) % pairs.length]!;
}

/** Soft two-tone gradient that adapts to light/dark via the surface token. */
export function coverBackground(id: string) {
  const [a, b] = coverColors(id);
  return [
    `radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, ${a} 42%, transparent), transparent 62%)`,
    `radial-gradient(100% 100% at 100% 100%, color-mix(in srgb, ${b} 40%, transparent), transparent 64%)`,
    `linear-gradient(135deg, color-mix(in srgb, ${a} 10%, var(--tx-surface-2)), color-mix(in srgb, ${b} 12%, var(--tx-surface-2)))`,
  ].join(', ');
}

/** Frame + paper used by project cards and template cards. */
export function Cover({
  background,
  preview,
  title,
  thumbnail,
  accent,
  className,
  children,
}: {
  background: string;
  preview?: DocPreview;
  title?: string;
  thumbnail?: string;
  accent?: string;
  className?: string;
  children?: ReactNode;
}) {
  const slides = preview?.kind === 'slides';
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background }}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        style={{
          backgroundImage: 'radial-gradient(color-mix(in srgb, var(--tx-fg) 22%, transparent) 0.8px, transparent 0.8px)',
          backgroundSize: '14px 14px',
          maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
        }}
      />
      <Paper
        preview={preview}
        fallbackTitle={title}
        thumbnail={thumbnail}
        accent={accent}
        className={cn(
          'absolute left-1/2 -translate-x-1/2 rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.08),0_12px_32px_-8px_rgb(0_0_0/0.28)] ring-1 ring-black/5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5',
          slides ? 'top-[18%] w-[74%] rounded-[4px]' : 'top-[13%] w-[60%]',
        )}
      />
      {children}
    </div>
  );
}
