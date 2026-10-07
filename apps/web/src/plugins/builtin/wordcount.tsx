/**
 * Word count — status-bar item (active file) + a panel with the whole
 * document (main file + \input/\include/\subfile/\import), per-section and
 * per-file breakdowns and reading time. Uses only the public PluginAPI.
 */
import { useEffect, useMemo, useState } from 'react';
import { definePlugin, type PluginAPI } from '@texit/plugin-api';
import { documentBody, stripComments } from '@/plugins/lib/latexText';
import { EmptyState, PanelHeader, Segmented, Spinner } from '@/ui';
import { mountReact } from './mount';

// ───────────────────────────── analysis ─────────────────────────────

interface Segment {
  path: string;
  text: string;
  startLine: number;
}

export interface SectionCount {
  title: string;
  kind: string;
  level: number;
  path: string;
  line: number;
  words: number;
}

export interface DocumentCount {
  mainPath: string | null;
  words: number;
  characters: number;
  mathInline: number;
  mathDisplay: number;
  sections: SectionCount[];
  files: { path: string; words: number }[];
}

const INCLUDE_RE = /\\(?:(input|include|subfile)\s*\{([^}]+)\}|(import|subimport|includefrom|subincludefrom)\s*\{([^}]*)\}\s*\{([^}]+)\})/g;
const HEADING_RE = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\]\s*)?\{/g;
const LEVEL: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };

function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
function join(dir: string, p: string) {
  const parts: string[] = [];
  for (const seg of `${dir}/${p}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function readBraced(text: string, open: number): { value: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { value: text.slice(open + 1, i), end: i + 1 };
  }
  return { value: text.slice(open + 1), end: text.length };
}

async function flatten(api: PluginAPI, path: string, mainDir: string, isMain: boolean, seen: Set<string>, depth = 0): Promise<Segment[]> {
  if (seen.has(path) || depth > 12) return [];
  seen.add(path);
  const raw = await api.project.readFile(path);
  if (typeof raw !== 'string') return [];
  // Comment-stripping keeps line structure, so line numbers stay valid.
  const clean = stripComments(raw);
  const { body, lineOffset } = isMain ? documentBody(clean) : { body: clean, lineOffset: 0 };
  const known = new Set(api.project.listFiles().map((f) => f.path));
  const resolve = (ref: string, baseDir: string) => {
    for (const dir of [baseDir, mainDir, dirOf(path)]) {
      const cand = join(dir, ref.trim());
      if (known.has(cand)) return cand;
      if (known.has(`${cand}.tex`)) return `${cand}.tex`;
    }
    return null;
  };
  const out: Segment[] = [];
  let last = 0;
  const lineAt = (idx: number) => lineOffset + 1 + (body.slice(0, idx).match(/\n/g)?.length ?? 0);
  for (const m of body.matchAll(INCLUDE_RE)) {
    const idx = m.index ?? 0;
    out.push({ path, text: body.slice(last, idx), startLine: lineAt(last) });
    last = idx + m[0].length;
    const cmd = m[1] ?? m[3];
    const dirArg = m[1] ? undefined : m[4];
    const fileArg = m[1] ? m[2] : m[5];
    const base = cmd.startsWith('sub') ? join(dirOf(path), dirArg ?? '') : dirArg ? join(mainDir, dirArg) : mainDir;
    const target = resolve(fileArg, base);
    if (target) out.push(...(await flatten(api, target, mainDir, false, seen, depth + 1)));
  }
  out.push({ path, text: body.slice(last), startLine: lineAt(last) });
  return out;
}

export async function countDocument(api: PluginAPI): Promise<DocumentCount | null> {
  const main = api.project.getMainPath() ?? api.editor.getActivePath();
  if (!main) return null;
  const segments = await flatten(api, main, dirOf(main), true, new Set());
  const result: DocumentCount = { mainPath: main, words: 0, characters: 0, mathInline: 0, mathDisplay: 0, sections: [], files: [] };
  const perFile = new Map<string, number>();
  let current: SectionCount = { title: 'Before the first heading', kind: 'front', level: -1, path: main, line: 1, words: 0 };
  const add = (text: string, path: string) => {
    if (!text.trim()) return;
    const c = api.latex.countWords(text);
    result.words += c.words;
    result.characters += c.characters;
    result.mathInline += c.mathInline;
    result.mathDisplay += c.mathDisplay;
    current.words += c.words;
    perFile.set(path, (perFile.get(path) ?? 0) + c.words);
  };
  for (const seg of segments) {
    let last = 0;
    for (const m of seg.text.matchAll(HEADING_RE)) {
      const idx = m.index ?? 0;
      add(seg.text.slice(last, idx), seg.path);
      const { value, end } = readBraced(seg.text, idx + m[0].length - 1);
      if (current.words > 0 || current.kind !== 'front') result.sections.push(current);
      current = {
        title: value.replace(/\\[a-zA-Z]+\*?\s*/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() || '(untitled)',
        kind: m[1],
        level: LEVEL[m[1]] ?? 2,
        path: seg.path,
        line: seg.startLine + (seg.text.slice(0, idx).match(/\n/g)?.length ?? 0),
        words: 0,
      };
      // The heading title itself counts as words of the new section.
      add(value, seg.path);
      last = end;
    }
    add(seg.text.slice(last), seg.path);
  }
  if (current.words > 0 || current.kind !== 'front') result.sections.push(current);
  result.files = Array.from(perFile.entries()).map(([path, words]) => ({ path, words }));
  return result;
}

const fmt = (n: number) => n.toLocaleString();
function readingTime(words: number, wpm: number) {
  const min = words / Math.max(60, wpm);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}

// ───────────────────────────── panel ─────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2/70 px-2.5 py-2 ring-1 ring-inset ring-border">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

function WordCountPanel({ api }: { api: PluginAPI }) {
  const [data, setData] = useState<DocumentCount | null | undefined>(undefined);
  const [view, setView] = useState<'sections' | 'files'>('sections');
  const [wpm, setWpm] = useState(() => api.settings.get<number>('wpm', 230));

  useEffect(() => {
    let alive = true;
    let seq = 0;
    const recount = async () => {
      const mine = ++seq;
      try {
        const d = await countDocument(api);
        if (alive && mine === seq) setData(d);
      } catch (err) {
        if (alive) setData(null);
        console.error(err);
      }
    };
    void recount();
    const subs = [
      api.project.onDidChangeFiles(recount),
      api.editor.onDidChangeActiveFile(() => void recount()),
      api.settings.onDidChange((k, v) => k === 'wpm' && setWpm(Number(v) || 230)),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => s.dispose());
    };
  }, [api]);

  const max = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...(view === 'sections' ? data.sections.map((s) => s.words) : data.files.map((f) => f.words)));
  }, [data, view]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Word count" />
      {data === undefined ? (
        <div className="flex flex-1 items-center justify-center text-fg-subtle">
          <Spinner />
        </div>
      ) : !data ? (
        <EmptyState title="Nothing to count" description="Open a project with a .tex file." />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <div className="rounded-xl bg-gradient-to-br from-accent-soft to-transparent p-3 ring-1 ring-inset ring-border">
            <div className="text-[11px] font-medium text-fg-muted">Whole document</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-fg">{fmt(data.words)}</span>
              <span className="text-[12px] text-fg-muted">words</span>
            </div>
            <div className="mt-1 truncate text-[11.5px] text-fg-subtle" title={data.mainPath ?? ''}>
              {data.files.length} file{data.files.length === 1 ? '' : 's'} from <span className="font-mono">{data.mainPath}</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Stat label="Reading time" value={readingTime(data.words, wpm)} />
            <Stat label="Characters" value={fmt(data.characters)} />
            <Stat label="Inline math" value={fmt(data.mathInline)} />
            <Stat label="Equations" value={fmt(data.mathDisplay)} />
          </div>

          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Breakdown</span>
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'sections', label: 'Sections' },
                { value: 'files', label: 'Files' },
              ]}
            />
          </div>
          <ul className="space-y-0.5">
            {(view === 'sections'
              ? data.sections.map((s) => ({ key: `${s.path}:${s.line}:${s.title}`, label: s.title, indent: Math.max(0, s.level - 1), words: s.words, path: s.path, line: s.line, muted: s.kind === 'front' }))
              : data.files.map((f) => ({ key: f.path, label: f.path, indent: 0, words: f.words, path: f.path, line: 1, muted: false }))
            ).map((row) => (
              <li key={row.key}>
                <button
                  onClick={() => api.editor.open(row.path, row.line)}
                  className="group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-hover"
                  style={{ paddingLeft: 8 + row.indent * 12 }}
                  title={`${row.path}:${row.line}`}
                >
                  <span
                    className="pointer-events-none absolute inset-y-1 left-0 rounded-r bg-accent/10 transition-[width] group-hover:bg-accent/15"
                    style={{ width: `${Math.max(2, (row.words / max) * 100)}%` }}
                  />
                  <span className={`relative min-w-0 flex-1 truncate ${row.muted ? 'italic text-fg-subtle' : 'text-fg'} ${view === 'files' ? 'font-mono text-[11.5px]' : ''}`}>
                    {row.label}
                  </span>
                  <span className="relative shrink-0 tabular-nums text-fg-muted">{fmt(row.words)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-fg-subtle">
            Approximate (texcount-style): comments, math and command names are not counted. Reading time at {wpm} words/min.
          </p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── plugin ─────────────────────────────

export default definePlugin({
  id: 'org.texit.wordcount',
  name: 'Word count',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'calculator',
  description: 'Live word count in the status bar, plus a per-section breakdown and reading time for the whole document.',
  permissions: ['project:read', 'ui'],
  tags: ['writing', 'statistics'],
  settings: [
    { key: 'wpm', title: 'Reading speed', description: 'Words per minute used to estimate reading time.', type: 'number', default: 230, min: 80, max: 800, step: 10 },
    { key: 'showStatus', title: 'Show in status bar', type: 'boolean', default: true },
  ],
  activate(api) {
    let current: { path: string; words: number; characters: number } | null = null;
    let seq = 0;

    const status = api.ui.registerStatusItem({
      id: 'status',
      align: 'right',
      priority: 10,
      render: () => {
        if (!current || !api.settings.get('showStatus', true)) return null;
        const wpm = api.settings.get<number>('wpm', 230);
        return {
          text: `${fmt(current.words)} words`,
          tooltip: `${current.path}\n${fmt(current.words)} words · ${fmt(current.characters)} characters · ${readingTime(current.words, wpm)} read\nClick for the whole document`,
        };
      },
      onClick: () => api.ui.showPanel('panel'),
    });

    const recount = async () => {
      const mine = ++seq;
      const path = api.editor.getActivePath();
      if (!path || !/\.(tex|ltx|latex|md|txt)$/i.test(path)) {
        current = null;
        return status.refresh();
      }
      const text = await api.project.readFile(path);
      if (mine !== seq) return;
      if (typeof text !== 'string') current = null;
      else {
        const src = /\.(tex|ltx|latex)$/i.test(path) && /\\begin\s*\{document\}/.test(text) ? documentBody(text).body : text;
        const c = api.latex.countWords(src);
        current = { path, words: c.words, characters: c.characters };
      }
      status.refresh();
    };
    void recount();
    api.editor.onDidChangeActiveFile(() => void recount());
    api.project.onDidChangeFiles(() => void recount());
    api.settings.onDidChange(() => status.refresh());

    api.ui.registerPanel({
      id: 'panel',
      title: 'Word count',
      icon: 'calculator',
      location: 'sidebar',
      render: (el) => mountReact(el, <WordCountPanel api={api} />),
    });

    api.commands.register({ id: 'show', title: 'Show word count', category: 'Tools', icon: 'calculator', run: () => api.ui.showPanel('panel') });
  },
});
