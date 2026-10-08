/**
 * LaTeX autocompletion: commands (catalog + user macros + math symbols),
 * environments (inserting the matching \end), \end auto-matching, labels,
 * citations, file paths, packages and document classes.
 *
 * Sources are registered as language data (not `override`) so extensions
 * contributed through `contributeEditorExtension` can add their own sources with
 * `EditorState.languageData.of(() => [{ autocomplete: mySource }])`.
 */
import {
  insertCompletionText,
  pickedCompletion,
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { basename, dirname, extname, isImagePath, isPdfPath, isTexPath, stripExtension } from '@texit/core';
import { getCatalog, documentClasses, packageDetail, type CatalogCommand, type CatalogEnvironment } from '../latexCatalog';
import { t as tr } from '@/lib/i18n';
import { getProjectIndex, stripComment, type IndexedBibEntry } from '../projectIndex';
import { fileInfo } from './fileInfo';
import { isInMath } from './math';

// ───────────────────────────── helpers ─────────────────────────────

const COMMON: Record<string, number> = {
  section: 12, subsection: 10, subsubsection: 6, chapter: 7, paragraph: 3, textbf: 10, emph: 10, textit: 8, texttt: 5,
  begin: 14, end: 8, label: 10, ref: 9, eqref: 7, cref: 6, cite: 9, citep: 5, citet: 5, item: 11, includegraphics: 8,
  usepackage: 9, caption: 8, footnote: 7, href: 5, url: 5, centering: 7, documentclass: 6, maketitle: 6, title: 6,
  author: 6, date: 4, input: 5, include: 4, frac: 10, sqrt: 7, sum: 7, int: 6, alpha: 7, beta: 6, gamma: 5, delta: 5,
  lambda: 5, mu: 4, pi: 5, sigma: 4, theta: 5, epsilon: 4, left: 6, right: 6, mathbb: 7, mathrm: 6, mathbf: 6,
  mathcal: 5, text: 8, quad: 5, cdot: 6, infty: 6, ldots: 6, dots: 5, partial: 5, times: 5, leq: 5, geq: 5, neq: 5,
  to: 4, in: 4, hat: 4, bar: 4, vec: 4, tableofcontents: 4, newcommand: 5, textsc: 3, underline: 4, hline: 5,
  toprule: 4, midrule: 4, bottomrule: 4, vspace: 4, hspace: 4, newpage: 4, bibliography: 4, bibliographystyle: 4,
};

const usageCache = new WeakMap<Text, Map<string, number>>();

/** Count \commands used in the document (cheap ranking signal). */
function usageCounts(doc: Text): Map<string, number> {
  let m = usageCache.get(doc);
  if (m) return m;
  m = new Map();
  const text = doc.length > 400_000 ? doc.sliceString(0, 400_000) : doc.toString();
  const re = /\\([a-zA-Z@]+)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(text))) m.set(r[1], (m.get(r[1]) ?? 0) + 1);
  usageCache.set(doc, m);
  return m;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ───────────────────────────── commands ─────────────────────────────

function commandApply(cmd: { name: string; snippet?: string }): Completion['apply'] {
  if (cmd.name === 'begin' || cmd.name === 'end') {
    return (view, completion, from, to) => {
      const next = view.state.sliceDoc(to, to + 1);
      const insert = next === '{' ? `\\${cmd.name}` : `\\${cmd.name}{`;
      view.dispatch({
        ...insertCompletionText(view.state, insert, from, to),
        annotations: pickedCompletion.of(completion),
      });
      if (next === '{') view.dispatch({ selection: { anchor: view.state.selection.main.head + 1 } });
      startCompletion(view);
    };
  }
  if (!cmd.snippet) return undefined;
  const snip = snippet(cmd.snippet);
  return (view, completion, from, to) => {
    const next = view.state.sliceDoc(to, to + 1);
    // Editing an existing command: keep its arguments.
    if (next === '{' || next === '[' || next === '(') {
      view.dispatch({ ...insertCompletionText(view.state, `\\${cmd.name}`, from, to), annotations: pickedCompletion.of(completion) });
      return;
    }
    snip(view, completion, from, to);
  };
}

let baseCommandOptions: { source: unknown; math: Completion[]; text: Completion[]; all: Completion[] } | null = null;

function catalogCommandOptions() {
  const catalog = getCatalog();
  if (baseCommandOptions?.source === catalog) return baseCommandOptions;
  const toOption = (cmd: CatalogCommand): Completion => {
    const detail = cmd.glyph ? `${cmd.glyph}${cmd.package ? `  ${cmd.package}` : ''}` : (cmd.detail ?? cmd.package);
    return {
      label: `\\${cmd.name}`,
      detail,
      info: cmd.info,
      type: cmd.math ? 'math' : 'cmd',
      apply: commandApply(cmd),
      boost: COMMON[cmd.name] ?? 0,
    };
  };
  const math: Completion[] = [];
  const text: Completion[] = [];
  for (const cmd of catalog.commands) {
    const opt = toOption(cmd);
    (cmd.math ? math : text).push(opt);
  }
  baseCommandOptions = { source: catalog, math, text, all: [...text, ...math] };
  return baseCommandOptions;
}

function commandCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[a-zA-Z@]*\*?/);
  if (!word) return null;
  if (word.from === word.to) return null;
  // `\\` (line break) shouldn't open completion.
  if (word.text === '\\' && ctx.state.sliceDoc(word.from - 1, word.from) === '\\') return null;
  const inMath = isInMath(ctx.state, ctx.pos);
  const base = catalogCommandOptions();
  const usage = usageCounts(ctx.state.doc);
  const seen = new Set<string>();
  const options: Completion[] = [];
  const push = (o: Completion) => {
    if (seen.has(o.label)) return;
    seen.add(o.label);
    options.push(o);
  };

  // User-defined macros first (they shadow catalog entries).
  const idx = getProjectIndex();
  if (idx) {
    try {
      for (const c of idx.userCommands()) {
        const args = Array.from({ length: Math.min(c.args, 9) }, (_, i) => `{\${${i + 1}}}`).join('');
        push({
          label: `\\${c.name}`,
          detail: tr('editor.complete.user', { file: basename(c.path) }),
          type: 'macro',
          boost: 8 + Math.min(10, usage.get(c.name) ?? 0),
          apply: c.args ? commandApply({ name: c.name, snippet: `\\${c.name}${args}` }) : undefined,
        });
      }
    } catch {
      /* index not ready */
    }
  }
  const adjust = (o: Completion, isMath: boolean): Completion => {
    const name = o.label.slice(1);
    const used = usage.get(name) ?? 0;
    let boost = (o.boost ?? 0) + Math.min(8, used);
    if (inMath) boost += isMath ? 6 : -2;
    else if (isMath) boost -= 6;
    return boost === o.boost ? o : { ...o, boost: Math.max(-99, Math.min(99, boost)) };
  };
  for (const o of base.text) push(adjust(o, false));
  for (const o of base.math) push(adjust(o, true));
  // Commands used in this document that the catalog doesn't know.
  const typed = word.text.replace(/^\\|\*$/g, '');
  for (const [name, count] of usage) {
    if (seen.has(`\\${name}`) || name.length < 2) continue;
    if (name === typed && count <= 1) continue; // the command being typed
    push({ label: `\\${name}`, type: 'cmd', detail: tr('editor.complete.inDocument'), boost: Math.min(6, count) - 2 });
  }
  return { from: word.from, options, validFor: /^\\[a-zA-Z@]*\*?$/ };
}

// ───────────────────────────── environments ─────────────────────────────

interface EnvScan {
  /** Innermost unclosed environment before the position. */
  open: string[];
}

const BEGIN_END = /\\(begin|end)\s*\{([^}]*)\}/g;

function scanEnvs(doc: Text, upTo: number, skipAt = -1): EnvScan {
  const stack: string[] = [];
  const endLine = doc.lineAt(upTo).number;
  for (let n = 1; n <= endLine; n++) {
    const line = doc.line(n);
    let text = stripComment(line.text);
    if (n === endLine) text = text.slice(0, upTo - line.from);
    if (!text.includes('\\')) continue;
    BEGIN_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BEGIN_END.exec(text))) {
      if (line.from + m.index === skipAt) continue;
      const name = m[2].trim();
      if (m[1] === 'begin') stack.push(name);
      else {
        const i = stack.lastIndexOf(name);
        if (i >= 0) stack.length = i;
      }
    }
  }
  return { open: stack };
}

/** Find the first \end{…} after `from` that has no matching \begin (ignoring the \begin at `skipAt`). */
function findOrphanEnd(doc: Text, skipAt: number): { from: number; to: number; name: string } | null {
  const stack: string[] = [];
  const startLine = doc.lineAt(skipAt).number;
  // Pre-fill the stack with environments open at the skip position.
  stack.push(...scanEnvs(doc, skipAt, skipAt).open);
  const base = stack.length;
  for (let n = startLine; n <= Math.min(doc.lines, startLine + 3000); n++) {
    const line = doc.line(n);
    const text = stripComment(line.text);
    BEGIN_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BEGIN_END.exec(text))) {
      const at = line.from + m.index;
      if (at <= skipAt) continue;
      const name = m[2].trim();
      if (m[1] === 'begin') stack.push(name);
      else {
        const i = stack.lastIndexOf(name);
        if (i >= base) {
          stack.length = i;
          continue;
        }
        // Closes the environment enclosing ours → our \begin has no \end yet.
        if (stack.length === base && base > 0 && stack[base - 1] === name) return null;
        const nameFrom = at + m[0].indexOf('{') + 1;
        return { from: nameFrom, to: nameFrom + m[2].length, name };
      }
    }
  }
  return null;
}

function envApply(name: string, env?: CatalogEnvironment): Completion['apply'] {
  return (view, completion, from, to) => {
    const { state } = view;
    const doc = state.doc;
    const after = doc.sliceString(to, Math.min(doc.length, to + 80));
    const close = /^[^}\s\\]*\}/.exec(after);
    const end = to + (close ? close[0].length : 0);
    const line = doc.lineAt(from);
    const rest = doc.sliceString(end, line.to);
    const beginAt = from - '\\begin{'.length;
    const orphan = state.sliceDoc(beginAt, from) === '\\begin{' ? findOrphanEnd(doc, beginAt) : null;
    if (orphan || rest.trim()) {
      // Renaming an existing environment: update both \begin and its \end.
      const changes = [{ from, to: end, insert: `${name}}` }];
      if (orphan) changes.push({ from: orphan.from, to: orphan.to, insert: name });
      view.dispatch({ changes, selection: { anchor: from + name.length + 1 }, annotations: pickedCompletion.of(completion), userEvent: 'input.complete' });
      return;
    }
    const body = env?.body ?? '${}';
    const bodyLines = body
      .split('\n')
      .map((l) => `\t${l}`)
      .join('\n');
    const tpl = `${name}}${env?.args ?? ''}\n${bodyLines}\n\\end{${name}}`;
    snippet(tpl)(view, completion, from, end);
  };
}

function environmentCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\begin\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const from = ctx.pos - m[1].length;
  const catalog = getCatalog();
  const options: Completion[] = [];
  const seen = new Set<string>();
  const inMath = isInMath(ctx.state, ctx.pos);
  const add = (name: string, env: CatalogEnvironment | undefined, extra: Partial<Completion>) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    options.push({ label: name, type: 'env', apply: envApply(name, env), detail: env?.package ?? env?.detail, ...extra });
  };
  const idx = getProjectIndex();
  try {
    for (const e of idx?.userEnvironments() ?? []) add(e.name, catalog.environmentIndex.get(e.name), { detail: tr('editor.complete.user', { file: basename(e.path) }), boost: 6 });
  } catch {
    /* ignore */
  }
  const commonEnv: Record<string, number> = { itemize: 10, enumerate: 9, figure: 9, table: 8, equation: 9, align: 8, 'align*': 6, tabular: 7, center: 5, document: 4, abstract: 4, frame: 5, description: 4, minipage: 4, 'equation*': 5, theorem: 3, proof: 3, cases: 4, pmatrix: 3, verbatim: 3, lstlisting: 3, tikzpicture: 4 };
  for (const env of catalog.environments) {
    const mathBoost = inMath ? (env.math ? 5 : -5) : env.math && /matrix|cases|aligned|gathered|split/.test(env.name) ? -4 : 0;
    add(env.name, env, { boost: (commonEnv[env.name] ?? 0) + mathBoost });
  }
  // Environments used in this document.
  const text = ctx.state.doc.length > 300_000 ? ctx.state.doc.sliceString(0, 300_000) : ctx.state.doc.toString();
  const typedAt = from - '\\begin{'.length;
  for (const mm of text.matchAll(/\\begin\{([^}\s]+)\}/g)) {
    if (mm.index === typedAt) continue; // the environment being typed
    add(mm[1], catalog.environmentIndex.get(mm[1]), { detail: tr('editor.complete.inDocument'), boost: 2 });
  }
  return { from, options, validFor: /^[\w*@:-]*$/ };
}

function endCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\end\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const from = ctx.pos - m[1].length;
  const beginAt = ctx.pos - m[0].length;
  const { open } = scanEnvs(ctx.state.doc, beginAt);
  const options: Completion[] = [];
  const innermost = open[open.length - 1];
  const apply = (name: string): Completion['apply'] => (view, completion, f, t) => {
    const after = view.state.sliceDoc(t, t + 60);
    const close = /^[^}\s\\]*\}/.exec(after);
    const end = t + (close ? close[0].length : 0);
    view.dispatch({ changes: { from: f, to: end, insert: `${name}}` }, selection: { anchor: f + name.length + 1 }, annotations: pickedCompletion.of(completion), userEvent: 'input.complete' });
  };
  const seen = new Set<string>();
  open
    .slice()
    .reverse()
    .forEach((name, i) => {
      if (seen.has(name)) return;
      seen.add(name);
      options.push({ label: name, type: 'env', detail: i === 0 ? tr('editor.complete.closeCurrent') : tr('editor.complete.open'), boost: 99 - i * 5, apply: apply(name) });
    });
  for (const env of getCatalog().environments) {
    if (seen.has(env.name)) continue;
    seen.add(env.name);
    options.push({ label: env.name, type: 'env', boost: -20, apply: apply(env.name) });
  }
  void innermost;
  return { from, options, validFor: /^[\w*@:-]*$/ };
}

// ───────────────────────────── labels & refs ─────────────────────────────

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 32);
}

function labelSuggestions(state: EditorState, pos: number): string[] {
  const { open } = scanEnvs(state.doc, pos);
  const env = open[open.length - 1] ?? '';
  const out: string[] = [];
  if (/figure|subfigure|wrapfigure/.test(env)) out.push('fig:');
  else if (/table/.test(env)) out.push('tab:');
  else if (/^(equation|align|gather|multline|eqnarray|flalign)/.test(env)) out.push('eq:');
  else if (/listing|lstlisting|minted/.test(env)) out.push('lst:');
  else if (/^(theorem|lemma|proposition|corollary|definition)/.test(env)) out.push(`${env.slice(0, 3)}:`);
  else if (env === 'frame') out.push('frame:');
  // Sectioning on the same / previous lines.
  const line = state.doc.lineAt(pos);
  for (let n = line.number; n >= Math.max(1, line.number - 2); n--) {
    const text = state.doc.line(n).text;
    const m = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(text);
    if (m) {
      const prefix = m[1] === 'chapter' ? 'ch:' : m[1] === 'part' ? 'part:' : m[1].startsWith('sub') ? 'sec:' : 'sec:';
      const s = slug(m[2]);
      out.unshift(s ? `${prefix}${s}` : prefix);
      break;
    }
  }
  return out;
}

function labelDefinitionCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\label\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const from = ctx.pos - m[1].length;
  const options: Completion[] = labelSuggestions(ctx.state, ctx.pos).map((s, i) => ({
    label: s,
    type: 'label',
    detail: tr('editor.complete.suggested'),
    boost: 10 - i,
  }));
  return options.length ? { from, options, validFor: /^[^}\s]*$/ } : null;
}

function refCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\([a-zA-Z]*ref|labelcref)\*?\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const seg = m[2].split(',').pop() ?? '';
  const lead = seg.length - seg.trimStart().length;
  const from = ctx.pos - seg.length + lead;
  const idx = getProjectIndex();
  if (!idx) return null;
  const current = ctx.state.facet(fileInfo);
  const cmd = m[1];
  const options: Completion[] = [];
  try {
    for (const l of idx.labels()) {
      const prefix = l.name.split(':')[0];
      let boost = l.fileId === current?.id ? 4 : 0;
      if (cmd === 'eqref' && prefix === 'eq') boost += 10;
      options.push({
        label: l.name,
        type: 'label',
        detail: `${basename(l.path)}:${l.line}`,
        boost,
        info: l.context
          ? () => {
              const box = el('div', 'tx-cm-info');
              box.append(el('div', 'font-mono text-[11.5px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words', l.context!.slice(0, 300)));
              box.append(el('div', 'mt-1.5 text-[11px] text-fg-subtle', `${l.path}:${l.line}`));
              return box;
            }
          : undefined,
      });
    }
  } catch {
    return null;
  }
  return { from, options, validFor: /^[^,}\s]*$/ };
}

// ───────────────────────────── citations ─────────────────────────────

function shortAuthors(author?: string): string {
  if (!author) return '';
  const names = author.split(/\s+and\s+/i).map((n) => {
    const s = n.trim();
    if (s.includes(',')) return s.split(',')[0].trim();
    const parts = s.split(/\s+/);
    return parts[parts.length - 1];
  });
  const clean = names.map((n) => n.replace(/[{}]/g, ''));
  if (clean.length > 2) return `${clean[0]} et al.`;
  return clean.join(' & ');
}

export function cleanBibText(s?: string): string {
  return (s ?? '')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bibCard(entry: IndexedBibEntry): HTMLElement {
  const box = el('div', 'tx-cm-info flex max-w-[380px] flex-col gap-1');
  const head = el('div', 'flex items-center gap-1.5');
  head.append(el('span', 'rounded bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-fg-muted ring-1 ring-border', `@${entry.type}`));
  head.append(el('span', 'font-mono text-[11.5px] font-semibold', entry.key));
  box.append(head);
  const f = entry.fields;
  const title = cleanBibText(f.title);
  if (title) box.append(el('div', 'text-[12.5px] font-semibold leading-snug text-fg', title));
  const author = cleanBibText(f.author ?? f.editor);
  if (author) box.append(el('div', 'text-[12px] leading-snug text-fg-muted', author.split(/\s+and\s+/i).join(', ')));
  const venue = cleanBibText(f.journal ?? f.booktitle ?? f.publisher ?? f.school ?? f.institution ?? f.howpublished);
  const meta = [venue, f.year ?? f.date?.slice(0, 4)].filter(Boolean).join(' · ');
  if (meta) box.append(el('div', 'text-[11.5px] text-fg-subtle', meta));
  box.append(el('div', 'mt-0.5 text-[10.5px] text-fg-subtle/80', `${entry.path}:${entry.line}`));
  return box;
}

function citeCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\([a-zA-Z]*cite[a-zA-Z]*|nocite|bibentry|fullcite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const seg = m[2].split(',').pop() ?? '';
  const lead = seg.length - seg.trimStart().length;
  const from = ctx.pos - seg.length + lead;
  const query = seg.trim().toLowerCase();
  const idx = getProjectIndex();
  if (!idx) return null;
  let entries: IndexedBibEntry[] = [];
  try {
    entries = idx.bibEntries();
  } catch {
    return null;
  }
  const already = new Set(m[2].split(',').map((s) => s.trim()).filter(Boolean));
  const terms = query.split(/\s+/).filter(Boolean);
  const scored: { e: IndexedBibEntry; score: number }[] = [];
  for (const e of entries) {
    if (already.has(e.key) && e.key.toLowerCase() !== query) continue;
    const key = e.key.toLowerCase();
    const hay = `${key} ${cleanBibText(e.fields.title).toLowerCase()} ${cleanBibText(e.fields.author).toLowerCase()} ${e.fields.year ?? ''}`;
    let score = 0;
    if (!terms.length) score = 1;
    else if (key.startsWith(query)) score = 100;
    else if (terms.every((t) => hay.includes(t))) score = 50 + (key.includes(terms[0]) ? 20 : 0);
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.key.localeCompare(b.e.key));
  const options: Completion[] = scored.slice(0, 200).map(({ e }, i) => ({
    label: e.key,
    type: 'cite',
    detail: [shortAuthors(cleanBibText(e.fields.author ?? e.fields.editor)), e.fields.year ?? e.fields.date?.slice(0, 4)].filter(Boolean).join(' ') || e.type,
    info: () => bibCard(e),
    boost: 99 - Math.min(i, 150),
  }));
  return { from, options, filter: false };
}

// ───────────────────────────── files ─────────────────────────────

function fileCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\(input|include|subfile|includegraphics|includesvg|includepdf|includestandalone|includeonly|bibliography|addbibresource|lstinputlisting|verbatiminput|subfileinclude)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const cmd = m[1];
  const multi = cmd === 'bibliography' || cmd === 'includeonly';
  const seg = multi ? (m[2].split(',').pop() ?? '') : m[2];
  const from = ctx.pos - seg.length + (seg.length - seg.trimStart().length);
  const idx = getProjectIndex();
  if (!idx) return null;
  const mainId = idx.mainFileId();
  const mainDir = mainId ? dirname(idx.project.getPath(mainId)) : '';
  const rel = (p: string) => (mainDir && p.startsWith(`${mainDir}/`) ? p.slice(mainDir.length + 1) : p);
  const current = ctx.state.facet(fileInfo);
  const options: Completion[] = [];
  for (const f of idx.files()) {
    const p = f.path;
    if (f.id === current?.id) continue;
    let insert: string | null = null;
    switch (cmd) {
      case 'input':
      case 'include':
      case 'subfile':
      case 'subfileinclude':
      case 'includeonly':
        if (isTexPath(p)) insert = cmd === 'subfile' ? rel(p) : stripExtension(rel(p));
        break;
      case 'includegraphics':
        if (isImagePath(p) || isPdfPath(p) || ['eps', 'ps'].includes(extname(p))) insert = rel(p);
        break;
      case 'includesvg':
        if (extname(p) === 'svg') insert = stripExtension(rel(p));
        break;
      case 'includepdf':
        if (isPdfPath(p)) insert = rel(p);
        break;
      case 'includestandalone':
        if (isTexPath(p)) insert = stripExtension(rel(p));
        break;
      case 'bibliography':
        if (extname(p) === 'bib') insert = stripExtension(rel(p));
        break;
      case 'addbibresource':
        if (extname(p) === 'bib') insert = rel(p);
        break;
      default:
        if (f.isText) insert = rel(p);
    }
    if (insert === null) continue;
    options.push({ label: insert, type: 'file', detail: dirname(p) || undefined });
  }
  return { from, options, validFor: /^[^,}]*$/ };
}

// ───────────────────────────── packages & classes ─────────────────────────────

function packageCompletions(ctx: CompletionContext, before: string): CompletionResult | null {
  const m = /\\(usepackage|RequirePackage|documentclass|LoadClass)\s*(?:\[[^\]]*\])?\s*\{([^}]*)$/.exec(before);
  if (!m) return null;
  const isClass = m[1] === 'documentclass' || m[1] === 'LoadClass';
  const seg = isClass ? m[2] : (m[2].split(',').pop() ?? '');
  const from = ctx.pos - seg.length + (seg.length - seg.trimStart().length);
  const idx = getProjectIndex();
  const local = (idx?.files() ?? []).filter((f) => extname(f.path) === (isClass ? 'cls' : 'sty')).map((f) => stripExtension(basename(f.path)));
  const options: Completion[] = [];
  for (const name of local) options.push({ label: name, type: 'package', detail: tr('editor.complete.project'), boost: 10 });
  if (isClass) for (const c of documentClasses) options.push({ label: c, type: 'package' });
  else for (const p of getCatalog().packages) options.push({ label: p.name, type: 'package', detail: packageDetail(p) });
  return { from, options, validFor: /^[\w@.-]*$/ };
}

// ───────────────────────────── entry point ─────────────────────────────

/** Main LaTeX completion source. */
export const latexCompletionSource: CompletionSource = (ctx) => {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (stripComment(before).length !== before.length) return null;
  // Argument contexts (only when the cursor is inside the braces).
  if (/\{[^{}]*$/.test(before) && !/\\[a-zA-Z@]*\*?$/.test(before)) {
    const r =
      environmentCompletions(ctx, before) ??
      endCompletions(ctx, before) ??
      labelDefinitionCompletions(ctx, before) ??
      refCompletions(ctx, before) ??
      citeCompletions(ctx, before) ??
      fileCompletions(ctx, before) ??
      packageCompletions(ctx, before);
    if (r) return r;
  }
  return commandCompletions(ctx);
};

/** Reopen completion right after typing `{` in completable argument positions. */
export function shouldAutoTrigger(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  return /\\(begin|end|[a-zA-Z]*ref|labelcref|[a-zA-Z]*cite[a-zA-Z]*|input|include|includegraphics|bibliography|addbibresource|usepackage|documentclass|subfile)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{[^}]*$/.test(before);
}
