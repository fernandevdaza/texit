/**
 * Typographic previews for project covers and template cards: we extract the
 * title / author / first sections / a text snippet from the main .tex file and
 * render a miniature "typeset" page (see Paper.tsx). Results for projects are
 * cached in localStorage and refreshed lazily when a project changes.
 */
import { create } from 'zustand';
import type { ProjectSummary } from '@texit/core';
import { withProject } from '@/services/projects';

export type DocKind = 'article' | 'slides' | 'letter' | 'cv' | 'poster' | 'book';

export interface DocPreview {
  kind: DocKind;
  docClass?: string;
  title?: string;
  author?: string;
  abstract?: string;
  sections: string[];
  snippet?: string;
  hasMath?: boolean;
}

function stripComments(src: string) {
  return src.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** Very small LaTeX → plain text cleaner (good enough for thumbnails). */
export function cleanTex(s: string): string {
  return s
    .replace(/\\(?:thanks|footnote|label|cite[a-z]*|ref|eqref|autoref|cref|url|href\{[^}]*\})\s*(?:\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/\\\\(?:\[[^\]]*\])?/g, ' ')
    .replace(/\\(?:and|quad|qquad|newline|linebreak|par|noindent|centering|today|maketitle|small|large|Large|LARGE|huge|Huge|bfseries|itshape|scshape|normalsize|footnotesize)\b/g, ' ')
    .replace(/\$\$?[^$]*\$\$?/g, ' x ')
    .replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const arg = (cmd: string) => new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}`);

export function parseLatexPreview(source: string): DocPreview {
  const src = stripComments(source ?? '');
  const docClass = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(src)?.[1]?.trim();
  const dc = docClass?.toLowerCase() ?? '';
  let kind: DocKind = 'article';
  if (/beamer(?!poster)/.test(dc) || /\\begin\{frame\}/.test(src)) kind = 'slides';
  if (/poster/.test(dc) || /\\usepackage(\[[^\]]*\])?\{(beamerposter|tikzposter|baposter)\}/.test(src)) kind = 'poster';
  else if (/letter|lttr|lfm/.test(dc)) kind = 'letter';
  else if (/cv|resume|moderncv|altacv|awesome/.test(dc) || /\\(cventry|cvitem|resumeSubheading)/.test(src)) kind = 'cv';
  else if (/^(book|memoir|scrbook|report|scrreprt)$/.test(dc)) kind = 'book';

  let title = arg('title').exec(src)?.[1];
  if (!title && kind === 'cv') {
    const name = /\\name\s*\{([^}]*)\}\s*\{([^}]*)\}/.exec(src);
    title = name ? `${name[1]} ${name[2]}` : /\\(?:Huge|huge|LARGE)\s*(?:\\[a-z]+\s*)*\{?\s*([^\\}\n]{3,40})/.exec(src)?.[1];
  }
  const author = arg('author').exec(src)?.[1];
  const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(src)?.[1];

  const sections: string[] = [];
  const secRe = kind === 'slides' ? /\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*\{([^{}]*)\}|\\frametitle\s*\{([^{}]*)\}/g : /\\(?:chapter|section)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  for (const m of src.matchAll(secRe)) {
    const t = cleanTex(m[1] ?? m[2] ?? '');
    if (t) sections.push(t);
    if (sections.length >= 4) break;
  }

  // First paragraph of prose after \begin{document} (skipping \maketitle, abstract…).
  const body = src.split(/\\begin\{document\}/)[1] ?? src;
  const prose = body
    .replace(/\\begin\{(abstract|figure|table|tikzpicture|titlepage|equation\*?|align\*?)\}[\s\S]*?\\end\{\1\}/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => cleanTex(p))
    .find((p) => p.length > 40);

  return {
    kind,
    docClass,
    title: title ? cleanTex(title) || undefined : undefined,
    author: author ? cleanTex(author) || undefined : undefined,
    abstract: abstract ? cleanTex(abstract).slice(0, 320) : undefined,
    sections,
    snippet: prose?.slice(0, 420),
    hasMath: /\\begin\{(equation|align|gather|multline)|\\\[|\$\$/.test(body),
  };
}

// ───────────────────────────── project preview cache ─────────────────────────────

const KEY = 'texit:dashboard:previews';
const VERSION = 2;

interface Cached extends DocPreview {
  v: number;
  at: number;
}

function load(): Record<string, Cached> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Cached>;
    for (const k of Object.keys(raw)) if (raw[k]?.v !== VERSION) delete raw[k];
    return raw;
  } catch {
    return {};
  }
}

export const usePreviews = create<{ map: Record<string, Cached> }>(() => ({ map: typeof localStorage !== 'undefined' ? load() : {} }));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(usePreviews.getState().map));
    } catch {
      /* quota — previews are optional */
    }
  }, 400);
}

const queue: string[] = [];
const queued = new Set<string>();
let running = false;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift()!;
    queued.delete(id);
    try {
      const src = await withProject(id, (p) => {
        const main = p.getMainFileId();
        return main ? p.readText(main) : '';
      });
      const prev = parseLatexPreview(src);
      usePreviews.setState((s) => ({ map: { ...s.map, [id]: { ...prev, v: VERSION, at: Date.now() } } }));
      save();
    } catch {
      usePreviews.setState((s) => ({ map: { ...s.map, [id]: { kind: 'article', sections: [], v: VERSION, at: Date.now() } } }));
    }
    // Stay out of the way of interactions.
    await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(null), { timeout: 400 }) : setTimeout(r, 30)));
  }
  running = false;
}

/** Queue (re)extraction for projects whose preview is missing or stale. */
export function ensurePreviews(projects: ProjectSummary[]) {
  const map = usePreviews.getState().map;
  for (const p of projects) {
    if (p.trashed && map[p.id]) continue;
    const cached = map[p.id];
    if (cached && cached.at >= p.updatedAt) continue;
    if (!queued.has(p.id)) {
      queued.add(p.id);
      queue.push(p.id);
    }
  }
  void pump();
}

/** Drop cached previews of projects that no longer exist. */
export function prunePreviews(ids: Set<string>) {
  const map = usePreviews.getState().map;
  const stale = Object.keys(map).filter((k) => !ids.has(k));
  if (!stale.length) return;
  const next = { ...map };
  stale.forEach((k) => delete next[k]);
  usePreviews.setState({ map: next });
  save();
}
