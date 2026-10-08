import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useSettings, type EditorSettings, type Keymap } from '@/state/settings';
import { cn } from '@/lib/cn';
import { useLocale, useT, type Locale } from '@/lib/i18n';
import { Input, Segmented, Select } from '@/ui';
import { Slider } from '@/ui/Slider';
import { Card, Row, ToggleRow, ValuePill } from '../parts';

/** `labelKey` (when set) is the translated label; brand font names are not translated. */
const fonts: { value: string; label: string; labelKey?: string; family: string }[] = [
  { value: 'jetbrains', label: 'JetBrains Mono', family: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace' },
  { value: 'system-mono', label: 'System monospace', labelKey: 'settings.editor.fontSystemMono', family: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { value: 'fira', label: 'Fira Code', family: '"Fira Code", ui-monospace, Menlo, monospace' },
  { value: 'cascadia', label: 'Cascadia Code', family: '"Cascadia Code", ui-monospace, Consolas, monospace' },
  { value: 'iosevka', label: 'Iosevka', family: '"Iosevka", ui-monospace, Menlo, monospace' },
  { value: 'inter', label: 'Inter (proportional)', labelKey: 'settings.editor.fontInter', family: '"Inter Variable", ui-sans-serif, system-ui, sans-serif' },
  { value: 'serif', label: 'Serif (proportional)', labelKey: 'settings.editor.fontSerif', family: '"Iowan Old Style", Charter, Georgia, "Times New Roman", serif' },
];

const SAMPLE: Record<Locale, string[]> = {
  en: [
    '\\section{Results}\\label{sec:results}',
    'We prove that $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ holds for every \\textbf{natural} number $n$, as conjectured in \\cite{gauss1801}. % TODO: tidy',
    '\\begin{equation}',
    '\tE = mc^2',
    '\\end{equation}',
  ],
  es: [
    '\\section{Resultados}\\label{sec:results}',
    'Demostramos que $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ se cumple para todo número \\textbf{natural} $n$, como se conjetura en \\cite{gauss1801}. % TODO: pulir',
    '\\begin{equation}',
    '\tE = mc^2',
    '\\end{equation}',
  ],
};

/** Tiny LaTeX highlighter for the preview (not the real editor). */
function renderLine(line: string, rich: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(%.*$)|(\$[^$]*\$)|(\\(?:section|subsection|chapter)\{)([^}]*)(\})|(\\textbf\{)([^}]*)(\})|(\\[a-zA-Z]+)|([{}])/g;
  let last = 0;
  let k = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="italic text-fg-subtle">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="text-[#0d9488] dark:text-[#2dd4bf]">{m[2]}</span>);
    else if (m[3])
      out.push(
        <span key={k++}>
          <span className="text-[#7c3aed] dark:text-[#b69cff]">{m[3]}</span>
          <span className={cn(rich && 'text-[1.18em] font-bold text-fg')}>{m[4]}</span>
          <span className="text-[#7c3aed] dark:text-[#b69cff]">{m[5]}</span>
        </span>,
      );
    else if (m[6])
      out.push(
        <span key={k++}>
          <span className="text-[#7c3aed] dark:text-[#b69cff]">{m[6]}</span>
          <span className={cn(rich && 'font-bold text-fg')}>{m[7]}</span>
          <span className="text-[#7c3aed] dark:text-[#b69cff]">{m[8]}</span>
        </span>,
      );
    else if (m[9]) out.push(<span key={k++} className="text-[#2563eb] dark:text-[#7cb3ff]">{m[9]}</span>);
    else if (m[10]) out.push(<span key={k++} className="text-fg-subtle">{m[10]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function Preview({ e }: { e: EditorSettings }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="mb-7 overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      <div className="flex h-8 items-center gap-2 border-b border-border bg-surface-2/60 px-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[11.5px] text-fg-subtle">{t('settings.editor.previewTitle')}</span>
        <span className="ml-auto rounded bg-surface px-1.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-subtle ring-1 ring-border">
          {e.keymap === 'default' ? t('settings.editor.standard') : e.keymap}
        </span>
      </div>
      <div
        className={cn('max-h-[220px] overflow-auto py-2 text-fg', e.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}
        style={{ fontFamily: e.fontFamily, fontSize: e.fontSize, lineHeight: e.lineHeight, tabSize: e.tabSize }}
      >
        {SAMPLE[locale].map((line, i) => (
          <div key={i} className={cn('flex', e.highlightActiveLine && i === 1 && 'bg-accent/[0.06]')}>
            {e.lineNumbers && (
              <span className="sticky left-0 w-9 shrink-0 select-none bg-inherit pr-2 text-right text-fg-subtle/70 tabular-nums" style={{ fontSize: e.fontSize * 0.85 }}>
                {i + 1}
              </span>
            )}
            {e.foldGutter && (
              <span className="flex w-4 shrink-0 select-none items-start justify-center pt-[0.35em] text-fg-subtle/70">
                {(i === 0 || i === 2) && <ChevronDown className="size-3" />}
              </span>
            )}
            <span className={cn('min-w-0 flex-1 pr-4', !e.lineNumbers && !e.foldGutter && 'pl-4')}>
              {renderLine(line, e.richText)}
              {i === 1 && e.highlightActiveLine && <span className="ml-px inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-pulse bg-accent" />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditorSection() {
  const e = useSettings((s) => s.editor);
  const setEditor = useSettings((s) => s.setEditor);
  const preset = fonts.find((f) => f.family === e.fontFamily)?.value ?? 'custom';
  const [custom, setCustom] = useState(preset === 'custom' ? e.fontFamily : '');
  const [showCustom, setShowCustom] = useState(preset === 'custom');
  const t = useT();
  useEffect(() => {
    if (preset === 'custom') setShowCustom(true);
  }, [preset]);

  return (
    <>
      <Preview e={e} />

      <Card title={t('settings.editor.text')}>
        <Row title={t('settings.editor.font')} description={t('settings.editor.fontHint')} stack={showCustom}>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-[210px]"
              value={showCustom ? 'custom' : preset}
              onValueChange={(v) => {
                if (v === 'custom') {
                  setShowCustom(true);
                  return;
                }
                setShowCustom(false);
                setEditor({ fontFamily: fonts.find((f) => f.value === v)!.family });
              }}
              options={[
                ...fonts.map((f) => ({ value: f.value, label: <span style={{ fontFamily: f.family }}>{f.labelKey ? t(f.labelKey) : f.label}</span> })),
                { value: 'custom', label: t('settings.editor.fontCustom') },
              ]}
            />
            {showCustom && (
              <Input
                className="w-[260px] font-mono text-[12px]"
                placeholder={'"My Font", monospace'}
                value={custom}
                onChange={(ev) => setCustom(ev.target.value)}
                onBlur={() => custom.trim() && setEditor({ fontFamily: custom.trim() })}
                onKeyDown={(ev) => ev.key === 'Enter' && custom.trim() && setEditor({ fontFamily: custom.trim() })}
              />
            )}
          </div>
        </Row>
        <Row title={t('settings.editor.fontSize')}>
          <Slider aria-label={t('settings.editor.fontSize')} min={10} max={24} step={1} value={e.fontSize} onValueChange={(v) => setEditor({ fontSize: v })} />
          <ValuePill>{e.fontSize}px</ValuePill>
        </Row>
        <Row title={t('settings.editor.lineHeight')}>
          <Slider aria-label={t('settings.editor.lineHeight')} min={1.2} max={2.2} step={0.05} value={e.lineHeight} onValueChange={(v) => setEditor({ lineHeight: Math.round(v * 100) / 100 })} />
          <ValuePill>{e.lineHeight.toFixed(2)}</ValuePill>
        </Row>
        <Row title={t('settings.editor.tabSize')} description={t('settings.editor.tabSizeHint')}>
          <Segmented
            size="sm"
            value={String(e.tabSize)}
            onChange={(v) => setEditor({ tabSize: Number(v) })}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: '8', label: '8' },
            ]}
          />
        </Row>
      </Card>

      <Card title={t('settings.editor.editing')}>
        <Row title={t('settings.editor.keymap')} description={t('settings.editor.keymapHint')}>
          <Segmented
            size="sm"
            value={e.keymap}
            onChange={(v) => setEditor({ keymap: v as Keymap })}
            options={[
              { value: 'default', label: t('settings.editor.standard') },
              { value: 'vim', label: 'Vim' },
              { value: 'emacs', label: 'Emacs' },
            ]}
          />
        </Row>
        <ToggleRow title={t('settings.editor.wordWrap')} description={t('settings.editor.wordWrapHint')} checked={e.wordWrap} onChange={(v) => setEditor({ wordWrap: v })} />
        <ToggleRow title={t('settings.editor.autoClose')} description={t('settings.editor.autoCloseHint')} checked={e.autoCloseBrackets} onChange={(v) => setEditor({ autoCloseBrackets: v })} />
        <ToggleRow title={t('settings.editor.autocomplete')} description={t('settings.editor.autocompleteHint')} checked={e.autocomplete} onChange={(v) => setEditor({ autocomplete: v })} />
        <ToggleRow title={t('settings.editor.spellcheck')} description={t('settings.editor.spellcheckHint')} checked={e.spellcheck} onChange={(v) => setEditor({ spellcheck: v })} />
      </Card>

      <Card title={t('settings.editor.display')}>
        <ToggleRow title={t('settings.editor.richText')} description={t('settings.editor.richTextHint')} checked={e.richText} onChange={(v) => setEditor({ richText: v })} />
        <ToggleRow title={t('settings.editor.mathPreview')} description={t('settings.editor.mathPreviewHint')} checked={e.mathPreview} onChange={(v) => setEditor({ mathPreview: v })} />
        <ToggleRow title={t('settings.editor.lineNumbers')} checked={e.lineNumbers} onChange={(v) => setEditor({ lineNumbers: v })} />
        <ToggleRow title={t('settings.editor.activeLine')} checked={e.highlightActiveLine} onChange={(v) => setEditor({ highlightActiveLine: v })} />
        <ToggleRow title={t('settings.editor.folding')} description={t('settings.editor.foldingHint')} checked={e.foldGutter} onChange={(v) => setEditor({ foldGutter: v })} />
        <ToggleRow title={t('settings.editor.liveLint')} description={t('settings.editor.liveLintHint')} checked={e.liveLint} onChange={(v) => setEditor({ liveLint: v })} />
      </Card>
    </>
  );
}
