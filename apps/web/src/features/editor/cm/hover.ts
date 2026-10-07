/**
 * Rich hovers: KaTeX math preview (hover + under the cursor), bibliography
 * cards on \cite keys, label context on \ref, image thumbnails on
 * \includegraphics, and glyph/description for known commands.
 */
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import { basename, extname, isImagePath } from '@texit/core';
import { getCatalog } from '../latexCatalog';
import { getProjectIndex, stripComment, type IndexedLabel } from '../projectIndex';
import { bibCard } from './completion';
import { fileInfo } from './fileInfo';
import { mathRegionAt, mathSource, renderMath, type MathRegion } from './math';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function card(children: (HTMLElement | null)[], cls = ''): HTMLElement {
  const box = el('div', `cm-tx-card px-3 py-2.5 ${cls}`);
  for (const c of children) if (c) box.append(c);
  return box;
}

/** Find a `\cmd{a,b,c}`-style argument item under `pos` on its line. */
function argItemAt(state: EditorState, pos: number, re: RegExp): { cmd: string; item: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const argStart = m.index + m[0].length - m[m.length - 1].length - 1; // index of '{'
    const start = line.from + argStart + 1;
    const end = start + m[m.length - 1].length;
    if (pos < line.from + m.index || pos > end) continue;
    if (pos < start) {
      // Hovering the command name: take the first item.
      const first = m[m.length - 1].split(',')[0];
      return { cmd: m[1], item: first.trim(), from: line.from + m.index, to: end + 1 };
    }
    let offset = start;
    for (const part of m[m.length - 1].split(',')) {
      const pFrom = offset;
      const pTo = offset + part.length;
      if (pos >= pFrom && pos <= pTo) {
        const lead = part.length - part.trimStart().length;
        return { cmd: m[1], item: part.trim(), from: pFrom + lead, to: pFrom + lead + part.trim().length };
      }
      offset = pTo + 1;
    }
  }
  return null;
}

const CITE_RE = /\\([a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;
const REF_RE = /\\([a-zA-Z]*ref|labelcref)\*?\s*\{([^}]*)\}/g;
const GFX_RE = /\\(includegraphics|includesvg)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;

// ───────────────────────────── math ─────────────────────────────

function mathDom(state: EditorState, region: MathRegion): HTMLElement {
  const box = el('div', 'cm-tx-math px-4 py-3');
  const inner = el('div', 'cm-tx-math-inner');
  box.append(inner);
  const ok = renderMath(inner, mathSource(state, region), region.display, region.env);
  if (!ok) box.classList.add('cm-tx-math-error');
  return box;
}

// ───────────────────────────── refs ─────────────────────────────

function labelKind(name: string): string {
  const p = name.split(':')[0].toLowerCase();
  return (
    { fig: 'Figure', tab: 'Table', eq: 'Equation', sec: 'Section', ch: 'Chapter', chap: 'Chapter', lst: 'Listing', thm: 'Theorem', lem: 'Lemma', def: 'Definition', app: 'Appendix' } as Record<string, string>
  )[p] ?? 'Label';
}

function refDom(label: IndexedLabel, text: string): HTMLElement {
  const head = el('div', 'flex items-center gap-1.5');
  head.append(el('span', 'rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent', labelKind(label.name)));
  head.append(el('span', 'font-mono text-[11.5px] font-semibold', label.name));
  const parts: (HTMLElement | null)[] = [head];
  // If the label sits inside a math environment, render it.
  const lines = text.split('\n');
  const idx = label.line - 1;
  let begin = -1;
  let env = '';
  for (let i = idx; i >= Math.max(0, idx - 40); i--) {
    const m = /\\begin\{((?:equation|align|gather|multline|flalign|eqnarray)\*?)\}/.exec(lines[i] ?? '');
    if (m) {
      begin = i;
      env = m[1];
      break;
    }
    if (/\\end\{/.test(lines[i] ?? '') && i !== idx) break;
  }
  if (begin >= 0) {
    let end = -1;
    for (let i = idx; i < Math.min(lines.length, idx + 60); i++) {
      if (lines[i]?.includes(`\\end{${env}}`)) {
        end = i;
        break;
      }
    }
    if (end >= 0) {
      const src = lines
        .slice(begin, end + 1)
        .join('\n')
        .replace(new RegExp(`^[\\s\\S]*?\\\\begin\\{${env.replace('*', '\\*')}\\}`), '')
        .replace(new RegExp(`\\\\end\\{${env.replace('*', '\\*')}\\}[\\s\\S]*$`), '');
      const box = el('div', 'cm-tx-math mt-2 rounded-md bg-surface-2/60 px-3 py-2');
      renderMath(box, src, true, env);
      parts.push(box);
    }
  } else if (label.context) {
    // Section title or caption around the label.
    const ctx = lines.slice(Math.max(0, idx - 2), idx + 1).join('\n');
    const cap = /\\caption\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(lines.slice(Math.max(0, idx - 8), idx + 8).join('\n'));
    const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(ctx);
    const title = cap?.[1] ?? sec?.[2];
    if (title) parts.push(el('div', 'mt-1.5 text-[12.5px] leading-snug text-fg', title.replace(/\\[a-zA-Z]+\s*|[{}]/g, '').trim()));
    else parts.push(el('div', 'mt-1.5 font-mono text-[11.5px] text-fg-muted whitespace-pre-wrap', label.context.slice(0, 240)));
  }
  parts.push(el('div', 'mt-1.5 text-[10.5px] text-fg-subtle', `${label.path}:${label.line}`));
  return card(parts, 'max-w-[460px]');
}

// ───────────────────────────── images ─────────────────────────────

const GFX_EXTS = ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg', 'gif', 'webp'];

function imageDom(fileId: string, path: string): TooltipView {
  const idx = getProjectIndex()!;
  const box = card([], 'w-[260px]');
  let url: string | null = null;
  if (isImagePath(path)) {
    const data = idx.project.readBinary(fileId);
    const type = extname(path) === 'svg' ? 'image/svg+xml' : `image/${extname(path) === 'jpg' ? 'jpeg' : extname(path)}`;
    url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    const frame = el('div', 'tx-checker flex h-[160px] items-center justify-center overflow-hidden rounded-md ring-1 ring-border');
    const img = document.createElement('img');
    img.src = url;
    img.className = 'max-h-full max-w-full object-contain';
    const meta = el('div', 'mt-1.5 flex justify-between text-[11px] text-fg-subtle');
    meta.append(el('span', 'truncate font-medium text-fg-muted', basename(path)));
    const dims = el('span', 'tabular-nums', '');
    meta.append(dims);
    img.onload = () => (dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`);
    frame.append(img);
    box.append(frame, meta);
  } else {
    box.append(el('div', 'text-[12px] font-medium', basename(path)), el('div', 'text-[11px] text-fg-subtle', `${extname(path).toUpperCase()} figure · preview not available`));
  }
  return {
    dom: box,
    destroy() {
      if (url) URL.revokeObjectURL(url);
    },
  };
}

// ───────────────────────────── hover source ─────────────────────────────

function hoverAt(view: EditorView, pos: number, side: -1 | 1): Tooltip | null {
  const { state } = view;
  const line = state.doc.lineAt(pos);
  if (stripComment(line.text).length < pos - line.from) return null;
  const idx = getProjectIndex();
  const current = state.facet(fileInfo);

  const cite = argItemAt(state, pos, CITE_RE);
  if (cite && idx) {
    const entry = idx.bibEntries().find((e) => e.key === cite.item);
    return {
      pos: cite.from,
      end: cite.to,
      above: true,
      create: () => ({ dom: entry ? card([bibCard(entry)]) : card([el('div', 'text-[12px] text-fg-muted', `No bibliography entry for “${cite.item}”`)]) }),
    };
  }
  const ref = argItemAt(state, pos, REF_RE);
  if (ref && idx) {
    const label = idx.labels().find((l) => l.name === ref.item);
    return {
      pos: ref.from,
      end: ref.to,
      above: true,
      create: () => ({
        dom: label ? refDom(label, idx.project.readText(label.fileId)) : card([el('div', 'text-[12px] text-fg-muted', `Undefined label “${ref.item}”`)]),
      }),
    };
  }
  const gfx = argItemAt(state, pos, GFX_RE);
  if (gfx && idx && gfx.item) {
    const id = idx.resolveInclude(gfx.item, current?.path, GFX_EXTS);
    if (!id) return { pos: gfx.from, end: gfx.to, above: true, create: () => ({ dom: card([el('div', 'text-[12px] text-fg-muted', `File not found: ${gfx.item}`)]) }) };
    return { pos: gfx.from, end: gfx.to, above: true, create: () => imageDom(id, idx.project.getPath(id)) };
  }

  // Math (skip when the cursor preview already shows this region).
  const region = mathRegionAt(state, pos, side);
  if (region && region.contentTo > region.contentFrom) {
    const cur = state.field(cursorMathField, false);
    if (cur && cur.pos === region.from) return null;
    return { pos: region.from, end: region.to, above: true, create: () => ({ dom: mathDom(state, region) }) };
  }

  // Known commands: glyph / description.
  const before = line.text.slice(0, pos - line.from + 1);
  const after = line.text.slice(pos - line.from + 1);
  const m1 = /\\([a-zA-Z@]+)$/.exec(before) ?? /\\([a-zA-Z@]*)$/.exec(before);
  if (m1) {
    const rest = /^[a-zA-Z@]*/.exec(after)?.[0] ?? '';
    const name = m1[1] + rest;
    const from = line.from + (before.length - m1[0].length);
    const to = from + name.length + 1;
    const cmd = getCatalog().commandIndex.get(name);
    let macro: { body: string; args: number } | undefined;
    if (!cmd && idx) {
      for (const f of idx.texFiles()) {
        macro = idx.macros(f.id).find((x) => x.name === name);
        if (macro) break;
      }
    }
    if (cmd && (cmd.glyph || cmd.info || cmd.detail || cmd.package)) {
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const head = el('div', 'flex items-center gap-2');
          if (cmd.glyph) head.append(el('span', 'text-[20px] leading-none text-fg', cmd.glyph));
          head.append(el('span', 'font-mono text-[12px] font-semibold', `\\${cmd.name}`));
          if (cmd.package) head.append(el('span', 'rounded bg-surface-2 px-1.5 py-px text-[10.5px] text-fg-muted ring-1 ring-border', cmd.package));
          const desc = cmd.info ?? cmd.detail;
          return { dom: card([head, desc ? el('div', 'mt-1 max-w-[340px] text-[12px] leading-snug text-fg-muted', desc) : null]) };
        },
      };
    }
    if (macro) {
      const m = macro;
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const head = el('div', 'flex items-center gap-2');
          head.append(el('span', 'font-mono text-[12px] font-semibold', `\\${name}`));
          head.append(el('span', 'rounded bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent', m.args ? `macro · ${m.args} arg${m.args > 1 ? 's' : ''}` : 'macro'));
          const body = el('div', 'mt-1.5 font-mono text-[11.5px] text-fg-muted break-all', m.body.slice(0, 200));
          const preview = el('div', 'cm-tx-math mt-1.5');
          if (!m.args) renderMath(preview, `\\${name}`, false);
          return { dom: card([head, body, m.args ? null : preview]) };
        },
      };
    }
  }
  return null;
}

// ───────────────────────────── cursor math preview ─────────────────────────────

interface CursorMath {
  pos: number;
  tooltip: Tooltip;
  key: string;
}

const cursorMathField = StateField.define<CursorMath | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const state = tr.state;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return null;
    const region = mathRegionAt(state, sel.head, -1) ?? mathRegionAt(state, sel.head, 1);
    if (!region || region.contentTo <= region.contentFrom) return null;
    const src = mathSource(state, region);
    if (!src.trim()) return null;
    // Inline math: only once there is something meaningful to show.
    if (!region.display && src.trim().length < 2) return null;
    const key = `${region.from}:${src}:${region.display}`;
    if (value && value.key === key) return value;
    const endLine = state.doc.lineAt(region.to);
    const startLine = state.doc.lineAt(region.from);
    const indent = startLine.text.length - startLine.text.trimStart().length;
    // Display math: below the block, aligned with its first column. Inline: below the formula.
    const anchor = region.display ? Math.min(endLine.to, endLine.from + indent) : region.from;
    const tooltip: Tooltip = {
      pos: anchor,
      above: false,
      strictSide: false,
      arrow: false,
      create: () => {
        const dom = el('div', 'cm-tx-math-preview');
        const label = el('div', 'cm-tx-math-label', 'Preview');
        dom.append(label, mathDom(state, region));
        return { dom, offset: { x: 0, y: 6 } };
      },
    };
    return { pos: region.from, tooltip, key };
  },
  provide: (f) => showTooltip.compute([f], (s) => s.field(f)?.tooltip ?? null),
});

export function hoverExtensions(opts: { mathPreview: boolean }): Extension {
  return [
    hoverTooltip(hoverAt, { hoverTime: 350 }),
    opts.mathPreview ? cursorMathField : [],
    EditorView.baseTheme({
      '.cm-tx-card': { fontSize: '12.5px' },
      '.cm-tx-math': { color: 'var(--tx-fg)', overflowX: 'auto', maxWidth: '600px' },
      '.cm-tx-math .katex-display': { margin: '0' },
      '.cm-tx-math .katex': { fontSize: '1.12em' },
      '.cm-tx-math-error': { opacity: '0.9' },
      '.cm-tx-math-error .katex-error': { color: 'var(--tx-danger) !important' },
      '.cm-tx-math-preview': { position: 'relative', minWidth: '120px' },
      '.cm-tx-math-preview .cm-tx-math': { paddingTop: '2px' },
      '.cm-tx-math-label': {
        padding: '6px 10px 0',
        fontSize: '9.5px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--tx-fg-subtle)',
        fontWeight: '600',
      },
      '.tx-checker': {
        backgroundColor: 'var(--tx-surface)',
        backgroundImage:
          'linear-gradient(45deg, var(--tx-surface-2) 25%, transparent 25%), linear-gradient(-45deg, var(--tx-surface-2) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--tx-surface-2) 75%), linear-gradient(-45deg, transparent 75%, var(--tx-surface-2) 75%)',
        backgroundSize: '14px 14px',
        backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
      },
    }),
  ];
}

