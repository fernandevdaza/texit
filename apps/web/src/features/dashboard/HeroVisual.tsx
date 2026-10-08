import { useMemo, type ReactNode } from 'react';
import katex from 'katex';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import './hero.css';

const L = ({ n, children, active }: { n: number; children?: ReactNode; active?: boolean }) => (
  <div className={`hx-line${active ? ' is-active' : ''}`}>
    <span className="hx-ln">{n}</span>
    <span>{children}</span>
  </div>
);
const C = ({ children }: { children: ReactNode }) => <span className="hx-cmd">{children}</span>;
const E = ({ children }: { children: ReactNode }) => <span className="hx-env">{children}</span>;
const M = ({ children }: { children: ReactNode }) => <span className="hx-math">{children}</span>;

function tex(src: string, display = false) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' });
  } catch {
    return src;
  }
}

/** Animated editor + PDF composition (pure CSS animation, no images). */
export function HeroVisual() {
  const t = useT();
  const eq = useMemo(() => tex('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}', true), []);
  const euler = useMemo(() => tex('e^{i\\pi} + 1 = 0'), []);

  return (
    <div className="hx select-none" aria-hidden>
      <div className="hx-glow" style={{ left: '8%', top: '18%', width: '58%', height: '58%', background: 'var(--tx-accent)' }} />
      <div className="hx-glow" style={{ right: '0%', top: '0%', width: '42%', height: '46%', background: '#ec4899', opacity: 0.35 }} />

      {/* Editor */}
      <div className="hx-editor">
        <div className="hx-bar">
          <span className="hx-dot" style={{ background: '#ff5f57' }} />
          <span className="hx-dot" style={{ background: '#febc2e' }} />
          <span className="hx-dot" style={{ background: '#28c840' }} />
          <span className="hx-tab is-active">main.tex</span>
          <span className="hx-tab">refs.bib</span>
        </div>
        <div className="hx-code">
          <L n={1}>
            <C>\documentclass</C>{'{article}'}
          </L>
          <L n={2}>
            <C>\usepackage</C>{'{amsmath}'}
          </L>
          <L n={3}>
            <C>\title</C>
            {'{On the Beauty of Equations}'}
          </L>
          <L n={4}>
            <E>\begin</E>
            {'{document}'}
          </L>
          <L n={5}>
            <C>\section</C>
            {'{'}
            <span className="hx-sec">Introduction</span>
            {'}'}
          </L>
          <L n={6}>Euler's identity, <M>{'$e^{i\\pi}+1=0$'}</M>,</L>
          <L n={7} active>
            <span className="hx-typing">links five fundamental constants.</span>
            <span className="hx-caret" />
          </L>
          <L n={8}>
            <E>\begin</E>
            {'{equation}'}
          </L>
          <L n={9}>
            {'  '}
            <M>{'\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx'}</M>
            <span className="hx-peer" data-name="Grace" />
          </L>
          <L n={10}>
            {'    '}
            <M>{'= \\sqrt{\\pi}'}</M>
          </L>
          <L n={11}>
            <E>\end</E>
            {'{equation}'}
          </L>
          <L n={12}>
            <span className="hx-com">% TODO: add a proof sketch</span>
          </L>
        </div>
      </div>

      {/* PDF page */}
      <div className="hx-pdf">
        <div style={{ textAlign: 'center', fontSize: '2.9cqw', lineHeight: 1.2 }}>On the Beauty of Equations</div>
        <div style={{ textAlign: 'center', fontSize: '1.55cqw', marginTop: '1.4cqw', color: '#333' }}>Ada Lovelace · Grace Hopper</div>
        <div style={{ textAlign: 'center', fontSize: '1.35cqw', marginTop: '0.6cqw', color: '#555' }}>October 7, 2026</div>
        <div style={{ fontSize: '2cqw', fontWeight: 700, margin: '3.4cqw 0 1.2cqw', display: 'flex', gap: '1.8cqw' }}>
          <span>1</span>
          <span>Introduction</span>
        </div>
        <p style={{ fontSize: '1.42cqw', lineHeight: 1.45, textAlign: 'justify', textIndent: '2.4cqw' }}>
          Euler's identity, <span dangerouslySetInnerHTML={{ __html: euler }} style={{ fontSize: '1.05em' }} />, links five fundamental constants of mathematics in a single,
          strikingly simple relation.
        </p>
        <div style={{ position: 'relative', margin: '1.6cqw 0', display: 'flex', alignItems: 'center' }}>
          <span className="hx-sync" />
          <div style={{ flex: 1, position: 'relative' }} dangerouslySetInnerHTML={{ __html: eq }} />
          <span style={{ fontSize: '1.42cqw', position: 'relative' }}>(1)</span>
        </div>
        <p style={{ fontSize: '1.42cqw', lineHeight: 1.45, textAlign: 'justify', textIndent: '2.4cqw' }}>
          The Gaussian integral appears throughout probability and physics; we revisit three classical proofs and their geometric intuition.
        </p>
        {[100, 96, 100, 74].map((w, i) => (
          <div key={i} style={{ height: '1cqw', width: `${w}%`, background: '#e3e3e8', borderRadius: 9, marginTop: '1.25cqw' }} />
        ))}
      </div>

      {/* Floating chips */}
      <div className="hx-chip" style={{ left: '4%', top: '84%', animationDelay: '0.5s, 0s' }}>
        <CheckCircle2 style={{ color: 'var(--tx-success)' }} /> {t('dashboard.hero.chipCompiled')}
        <span style={{ color: 'var(--tx-fg-subtle)', fontWeight: 450 }}>{t('dashboard.hero.chipInBrowser')}</span>
      </div>
      <div className="hx-chip" style={{ left: '33%', top: '1.5%', animationDelay: '0.8s, 1.5s' }}>
        <span style={{ display: 'flex' }}>
          {['#6366f1', '#ec4899', '#14b8a6'].map((c, i) => (
            <span
              key={c}
              style={{
                width: '2.6cqw',
                height: '2.6cqw',
                borderRadius: 99,
                background: c,
                border: '0.35cqw solid var(--tx-elevated)',
                marginLeft: i ? '-0.9cqw' : 0,
                color: '#fff',
                fontSize: '1.2cqw',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}
            >
              {'AGE'[i]}
            </span>
          ))}
        </span>
        {t('dashboard.hero.chipEditing', { count: 3 })}
      </div>
      <div className="hx-chip hx-bubble" style={{ left: '58%', top: '74%', animationDelay: '1.2s, 0.7s' }}>
        <Sparkles style={{ color: 'var(--tx-accent)', flexShrink: 0, marginTop: '0.2cqw' }} />
        <span>
          <span style={{ fontWeight: 600 }}>{t('dashboard.hero.chipAgent')}</span> {t('dashboard.hero.chipAgentText')}
          <span className="hx-dots" style={{ display: 'block', marginTop: '0.8cqw' }}>
            <span />
            <span />
            <span />
          </span>
        </span>
      </div>
    </div>
  );
}
