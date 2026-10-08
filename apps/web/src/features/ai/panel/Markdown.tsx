import { memo, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Check, Copy, CornerDownLeft, Replace } from 'lucide-react';
import { getEditorBridge } from '@/services/editor';
import { IconButton, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { highlightLatex, isLatexLang } from '../components/latexHighlight';

/** Split Markdown into top-level blocks (respecting fences / display math) so finished blocks don't re-render while streaming. */
export function splitBlocks(md: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let math = false;
  for (const line of md.split('\n')) {
    const t = line.trim();
    const f = /^(```|~~~)/.exec(t)?.[1];
    if (f && (!fence || fence === f)) fence = fence ? null : f;
    else if (!fence && t === '$$') math = !math;
    if (!fence && !math && t === '' && !f) {
      if (cur.length) blocks.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks;
}

function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const latex = isLatexLang(lang);
  const body = useMemo(() => (latex ? highlightLatex(code) : code), [code, latex]);
  const bridge = getEditorBridge();
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex h-7 items-center justify-between border-b border-border pl-2.5 pr-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-fg-subtle">{lang || 'latex'}</span>
        <div className="flex items-center opacity-70 transition-opacity group-hover/code:opacity-100">
          <IconButton
            size="xs"
            label={copied ? t('common.copied') : t('common.copy')}
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </IconButton>
          <IconButton
            size="xs"
            label={t('ai.code.insertAtCursor')}
            onClick={() => {
              if (!bridge?.getView()) return void toast.error(t('ai.openFileFirst'));
              bridge.insertText(code);
              bridge.focus();
            }}
          >
            <CornerDownLeft />
          </IconButton>
          <IconButton
            size="xs"
            label={t('ai.code.replaceSelection')}
            onClick={() => {
              const sel = bridge?.getSelection();
              if (!bridge || !sel || sel.from === sel.to) return void toast.error(t('ai.code.selectToReplace'));
              bridge.replaceSelection(code);
              bridge.focus();
            }}
          >
            <Replace />
          </IconButton>
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-fg">
        <code>{body}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ children }) {
    const child = (Array.isArray(children) ? children[0] : children) as ReactElement<{ className?: string; children?: ReactNode }>;
    const cls = child?.props?.className ?? '';
    const lang = /language-([\w+-]+)/.exec(cls)?.[1];
    const code = String(child?.props?.children ?? '').replace(/\n$/, '');
    return <CodeBlock lang={lang} code={code} />;
  },
  code({ children, className }) {
    return <code className={cn('rounded bg-surface-2 px-1 py-px font-mono text-[0.9em] text-fg ring-1 ring-border', className)}>{children}</code>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[12px]">{children}</table>
      </div>
    );
  },
  th: ({ children }) => <th className="border-b border-border bg-surface-2 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2 py-1 align-top last:border-b-0">{children}</td>,
};

const Block = memo(function Block({ md }: { md: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} components={components}>
      {md}
    </ReactMarkdown>
  );
});

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div
      className={cn(
        'tx-md min-w-0 text-[13px] leading-relaxed text-fg',
        '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold',
        '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted',
        '[&_hr]:my-3 [&_hr]:border-border [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        '[&>*:first-child>*:first-child]:mt-0',
        className,
      )}
    >
      {blocks.map((b, i) => (
        <Block key={i} md={b} />
      ))}
    </div>
  );
}
