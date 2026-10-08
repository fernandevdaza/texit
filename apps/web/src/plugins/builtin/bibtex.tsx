/**
 * BibTeX tools — add references from DOI / arXiv / ISBN (content negotiation
 * via doi.org, DataCite DOIs for arXiv, Open Library for ISBNs), format a .bib
 * file, and find unused / missing / duplicate citations.
 */
import { useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Copy as CopyIcon } from 'lucide-react';
import { definePlugin, type PluginAPI } from '@texit/plugin-api';
import { Badge, Button, Segmented } from '@/ui';
import { formatBib, formatEntry, parseBib, uniqueKey, type BibNode } from '@/plugins/lib/bibtex';
import { mountReact } from './mount';
import { createTr, useTr, type Catalog } from './i18n';

const MESSAGES: Catalog = {
  en: {
    noBibFile: 'This project has no .bib file',
    createBibTitle: 'Create a bibliography file',
    chooseBib: 'Choose a .bib file',
    addTitle: 'Add reference from DOI, arXiv id or ISBN',
    unrecognized: 'Unrecognized identifier',
    unrecognizedHint: 'Enter a DOI (10.xxxx/…), an arXiv id (2101.00001) or an ISBN.',
    couldNotFetch: 'Could not fetch {kind} {id}',
    noEntry: 'The service returned no BibTeX entry',
    alreadyIn: 'Already in {path} as “{key}”',
    added: 'Added “{key}” to {path}',
    keyCopied: 'The key was copied to the clipboard.',
    couldNotParse: 'Could not parse {path}',
    alreadyFormatted: '{path} is already formatted',
    formatted: 'Formatted {path}',
    entries_one: '{count} entry',
    entries_other: '{count} entries',
    citedKeys_one: '{count} cited key',
    citedKeys_other: '{count} cited keys',
    bibEntries_one: '{count} bibliography entry',
    bibEntries_other: '{count} bibliography entries',
    allGood: 'Every citation is defined and every entry is used.',
    missing: 'Missing ({count})',
    unused: 'Unused ({count})',
    duplicates: 'Duplicates ({count})',
    missingHint: 'Cited in the text but not defined in any .bib file.',
    unusedHint: 'Defined in a .bib file but never cited.',
    duplicatesHint: 'Keys defined more than once.',
    nothingHere: 'Nothing here.',
    more: '+{count} more',
    keysCopied: 'Keys copied',
    copyKeys: 'Copy keys',
    citationCheck: 'Citation check',
  },
  es: {
    noBibFile: 'Este proyecto no tiene ningún archivo .bib',
    createBibTitle: 'Crear un archivo de bibliografía',
    chooseBib: 'Elige un archivo .bib',
    addTitle: 'Añadir referencia desde DOI, id de arXiv o ISBN',
    unrecognized: 'Identificador no reconocido',
    unrecognizedHint: 'Escribe un DOI (10.xxxx/…), un id de arXiv (2101.00001) o un ISBN.',
    couldNotFetch: 'No se pudo obtener {kind} {id}',
    noEntry: 'El servicio no devolvió ninguna entrada BibTeX',
    alreadyIn: 'Ya está en {path} como “{key}”',
    added: 'Se añadió “{key}” a {path}',
    keyCopied: 'La clave se copió al portapapeles.',
    couldNotParse: 'No se pudo analizar {path}',
    alreadyFormatted: '{path} ya tiene formato',
    formatted: 'Se formateó {path}',
    entries_one: '{count} entrada',
    entries_other: '{count} entradas',
    citedKeys_one: '{count} clave citada',
    citedKeys_other: '{count} claves citadas',
    bibEntries_one: '{count} entrada de bibliografía',
    bibEntries_other: '{count} entradas de bibliografía',
    allGood: 'Todas las citas están definidas y todas las entradas se usan.',
    missing: 'Faltantes ({count})',
    unused: 'Sin usar ({count})',
    duplicates: 'Duplicadas ({count})',
    missingHint: 'Citadas en el texto, pero no definidas en ningún archivo .bib.',
    unusedHint: 'Definidas en un archivo .bib, pero nunca citadas.',
    duplicatesHint: 'Claves definidas más de una vez.',
    nothingHere: 'No hay nada aquí.',
    more: '+{count} más',
    keysCopied: 'Claves copiadas',
    copyKeys: 'Copiar claves',
    citationCheck: 'Revisión de citas',
  },
};

type Entry = Extract<BibNode, { kind: 'entry' }>;

// ───────────────────────────── identifier detection ─────────────────────────────

export type RefId = { kind: 'doi'; id: string } | { kind: 'arxiv'; id: string } | { kind: 'isbn'; id: string };

export function detectIdentifier(input: string): RefId | null {
  const s = input.trim();
  const doi = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i.exec(s);
  const arxiv =
    /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i.exec(s);
  if (doi && !/arxiv\./i.test(doi[1])) return { kind: 'doi', id: doi[1].replace(/[.,;]+$/, '') };
  if (doi) {
    const m = /arxiv\.(.+)$/i.exec(doi[1]);
    if (m) return { kind: 'arxiv', id: m[1] };
  }
  if (arxiv) return { kind: 'arxiv', id: arxiv[1].replace(/v\d+$/, '') };
  const digits = s.replace(/^isbn[:\s]*/i, '').replace(/[\s-]/g, '');
  if (/^(97[89])?\d{9}[\dX]$/i.test(digits)) return { kind: 'isbn', id: digits.toUpperCase() };
  return null;
}

// ───────────────────────────── fetching ─────────────────────────────

async function fetchText(url: string, accept?: string): Promise<string> {
  const res = await fetch(url, { headers: accept ? { Accept: accept } : undefined });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'request failed'}`);
  return res.text();
}

async function bibFromDoi(doi: string): Promise<string> {
  const path = doi.split('/').map(encodeURIComponent).join('/');
  try {
    const text = await fetchText(`https://doi.org/${path}`, 'application/x-bibtex; charset=utf-8');
    if (text.trim().startsWith('@')) return text;
    throw new Error('Not BibTeX');
  } catch (err) {
    // Crossref's transform endpoint (CORS-enabled) as a fallback.
    const text = await fetchText(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`).catch(() => {
      throw err;
    });
    if (!text.trim().startsWith('@')) throw new Error('No BibTeX record for this DOI');
    return text;
  }
}

async function bibFromArxiv(id: string): Promise<string> {
  try {
    // arXiv registers DOIs with DataCite, which supports BibTeX content negotiation with CORS.
    return await bibFromDoi(`10.48550/arXiv.${id}`);
  } catch {
    const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const entry = doc.querySelector('entry');
    const title = entry?.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim();
    if (!entry || !title || title === 'Error') throw new Error('arXiv id not found');
    const authors = Array.from(entry.querySelectorAll('author > name')).map((n) => n.textContent?.trim()).filter(Boolean);
    const year = entry.querySelector('published')?.textContent?.slice(0, 4) ?? '';
    const cat = entry.getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'primary_category')[0]?.getAttribute('term') ?? '';
    return `@misc{arxiv${id.replace(/\W/g, '')},
  title = {${title}},
  author = {${authors.join(' and ')}},
  year = {${year}},
  eprint = {${id}},
  archivePrefix = {arXiv},
  primaryClass = {${cat}},
  url = {https://arxiv.org/abs/${id}},
}`;
  }
}

async function bibFromIsbn(isbn: string): Promise<string> {
  const json = JSON.parse(await fetchText(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`));
  const b = json[`ISBN:${isbn}`];
  if (!b) throw new Error('ISBN not found in Open Library');
  const title = [b.title, b.subtitle].filter(Boolean).join(': ');
  const authors = (b.authors ?? []).map((a: { name: string }) => a.name).join(' and ');
  const publisher = b.publishers?.[0]?.name ?? '';
  const address = b.publish_places?.[0]?.name ?? '';
  const year = /\d{4}/.exec(b.publish_date ?? '')?.[0] ?? '';
  const fields: [string, string][] = [
    ['title', title],
    ['author', authors],
    ['publisher', publisher],
    ['address', address],
    ['year', year],
    ['isbn', isbn],
  ];
  return `@book{isbn${isbn},\n${fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}},`)
    .join('\n')}\n}`;
}

export async function fetchBibtex(id: RefId): Promise<string> {
  if (id.kind === 'doi') return bibFromDoi(id.id);
  if (id.kind === 'arxiv') return bibFromArxiv(id.id);
  return bibFromIsbn(id.id);
}

// ───────────────────────────── keys ─────────────────────────────

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'in', 'and', 'to', 'with', 'from', 'towards', 'toward', 'via', 'is', 'are']);

function ascii(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\\[a-zA-Z]+|[{}\\'"`^~]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
}

/** `lastname` + `year` + first significant title word, e.g. `vaswani2017attention`. */
export function generateKey(e: Entry): string {
  const get = (n: string) => e.fields.find((f) => f.name === n)?.value.replace(/^[{"]|[}"]$/g, '') ?? '';
  const firstAuthor = get('author').split(/\s+and\s+/i)[0] ?? '';
  const last = firstAuthor.includes(',') ? firstAuthor.split(',')[0] : firstAuthor.trim().split(/\s+/).pop() ?? '';
  const year = /\d{4}/.exec(get('year') || get('date'))?.[0] ?? '';
  const word = get('title')
    .split(/\s+/)
    .map(ascii)
    .find((w) => w && !STOP.has(w.toLowerCase()));
  const key = `${ascii(last).toLowerCase()}${year}${(word ?? '').toLowerCase()}`;
  return key || e.key;
}

// ───────────────────────────── project helpers ─────────────────────────────

const bibFiles = (api: PluginAPI) => api.project.listFiles().filter((f) => /\.bib$/i.test(f.path)).map((f) => f.path);
const texFiles = (api: PluginAPI) => api.project.listFiles().filter((f) => /\.(tex|ltx|latex)$/i.test(f.path)).map((f) => f.path);

async function chooseBibFile(api: PluginAPI, opts: { allowCreate: boolean }): Promise<string | undefined> {
  const tr = createTr(api, MESSAGES);
  const files = bibFiles(api);
  const active = api.editor.getActivePath();
  if (active && files.includes(active) && !opts.allowCreate) return active;
  if (files.length === 1 && !opts.allowCreate) return files[0];
  const remembered = await api.storage.get<string>('lastBib');
  if (opts.allowCreate && files.length === 1) return files[0];
  if (opts.allowCreate && remembered && files.includes(remembered) && files.length > 1) {
    // Ask, but put the remembered file first.
    files.sort((a, b) => (a === remembered ? -1 : b === remembered ? 1 : 0));
  }
  if (!files.length) {
    if (!opts.allowCreate) {
      api.ui.toast(tr('noBibFile'), { type: 'warning' });
      return undefined;
    }
    const name = await api.ui.prompt({ title: tr('createBibTitle'), value: 'references.bib' });
    if (!name) return undefined;
    const path = /\.bib$/i.test(name) ? name : `${name}.bib`;
    await api.project.writeFile(path, '');
    return path;
  }
  return api.ui.quickPick(
    files.map((f) => ({ label: f, value: f })),
    { placeholder: tr('chooseBib') },
  );
}

// ───────────────────────────── commands ─────────────────────────────

async function addReference(api: PluginAPI) {
  const tr = createTr(api, MESSAGES);
  const input = await api.ui.prompt({ title: tr('addTitle'), placeholder: '10.1038/nature14539 · 1706.03762 · 978-0262035613' });
  if (!input) return;
  const id = detectIdentifier(input);
  if (!id) return api.ui.toast(tr('unrecognized'), { type: 'error', description: tr('unrecognizedHint') });
  let text: string;
  try {
    text = await fetchBibtex(id);
  } catch (err) {
    return api.ui.toast(tr('couldNotFetch', { kind: id.kind === 'arxiv' ? 'arXiv' : id.kind.toUpperCase(), id: id.id }), { type: 'error', description: err instanceof Error ? err.message : String(err) });
  }
  const entry = parseBib(text).find((n): n is Entry => n.kind === 'entry');
  if (!entry) return api.ui.toast(tr('noEntry'), { type: 'error' });
  const path = await chooseBibFile(api, { allowCreate: true });
  if (!path) return;
  void api.storage.set('lastBib', path);
  const existing = await api.project.readFile(path);
  const src = typeof existing === 'string' ? existing : '';
  const keys = new Set(parseBib(src).flatMap((n) => (n.kind === 'entry' ? [n.key] : [])));
  // Same DOI already present? Don't add twice.
  const doiField = entry.fields.find((f) => f.name === 'doi')?.value.replace(/^[{"]|[}"]$/g, '').toLowerCase();
  if (doiField) {
    const dup = parseBib(src).find(
      (n): n is Entry => n.kind === 'entry' && n.fields.some((f) => f.name === 'doi' && f.value.replace(/^[{"]|[}"]$/g, '').toLowerCase() === doiField),
    );
    if (dup) return api.ui.toast(tr('alreadyIn', { path, key: dup.key }), { type: 'info' });
  }
  if (api.settings.get('rekey', true)) entry.key = generateKey(entry);
  entry.key = uniqueKey(entry.key, keys);
  const formatted = formatEntry(entry);
  const next = src.trimEnd() ? `${src.trimEnd()}\n\n${formatted}\n` : `${formatted}\n`;
  await api.project.writeFile(path, next);
  const active = api.editor.getActivePath();
  if (api.settings.get('insertCite', false) && active && /\.tex$/i.test(active)) api.editor.insertText(`\\cite{${entry.key}}`);
  else void navigator.clipboard?.writeText(entry.key).catch(() => {});
  api.ui.toast(tr('added', { key: entry.key, path }), { type: 'success', description: api.settings.get('insertCite', false) ? undefined : tr('keyCopied') });
}

async function formatBibFile(api: PluginAPI) {
  const tr = createTr(api, MESSAGES);
  const path = await chooseBibFile(api, { allowCreate: false });
  if (!path) return;
  const src = await api.project.readFile(path);
  if (typeof src !== 'string') return;
  let out: string;
  try {
    out = formatBib(src, { sortEntries: api.settings.get('sortEntries', false) });
  } catch (err) {
    return api.ui.toast(tr('couldNotParse', { path }), { type: 'error', description: err instanceof Error ? err.message : String(err) });
  }
  if (out === src) return api.ui.toast(tr('alreadyFormatted', { path }), { type: 'info' });
  await api.project.writeFile(path, out);
  const n = parseBib(out).filter((x) => x.kind === 'entry').length;
  api.ui.toast(tr('formatted', { path }), { type: 'success', description: tr('entries', { count: n }) });
}

export interface CitationReport {
  missing: { key: string; locations: { path: string; line: number }[] }[];
  unused: { key: string; path: string; line: number }[];
  duplicates: { key: string; locations: { path: string; line: number }[] }[];
  citedCount: number;
  definedCount: number;
  nociteAll: boolean;
}

export async function analyzeCitations(api: PluginAPI): Promise<CitationReport> {
  const cited = new Map<string, { path: string; line: number }[]>();
  let nociteAll = false;
  for (const path of texFiles(api)) {
    const src = await api.project.readFile(path);
    if (typeof src !== 'string') continue;
    for (const c of api.latex.analyze(src).citations) {
      for (const key of c.keys) {
        if (key === '*') {
          nociteAll = true;
          continue;
        }
        cited.set(key, [...(cited.get(key) ?? []), { path, line: c.line }]);
      }
    }
  }
  const defined = new Map<string, { path: string; line: number }[]>();
  for (const path of bibFiles(api)) {
    const src = await api.project.readFile(path);
    if (typeof src !== 'string') continue;
    for (const n of parseBib(src)) if (n.kind === 'entry') defined.set(n.key, [...(defined.get(n.key) ?? []), { path, line: n.line }]);
  }
  return {
    missing: [...cited].filter(([k]) => !defined.has(k)).map(([key, locations]) => ({ key, locations })),
    unused: nociteAll ? [] : [...defined].filter(([k]) => !cited.has(k)).map(([key, locs]) => ({ key, ...locs[0] })),
    duplicates: [...defined].filter(([, l]) => l.length > 1).map(([key, locations]) => ({ key, locations })),
    citedCount: cited.size,
    definedCount: defined.size,
    nociteAll,
  };
}

function CitationReportView({ api, report, close }: { api: PluginAPI; report: CitationReport; close: () => void }) {
  const tr = useTr(api, MESSAGES);
  const [tab, setTab] = useState<'missing' | 'unused' | 'duplicates'>(report.missing.length ? 'missing' : report.unused.length ? 'unused' : 'duplicates');
  const open = (path: string, line: number) => {
    api.editor.open(path, line);
    close();
  };
  const rows =
    tab === 'missing'
      ? report.missing.map((m) => ({ key: m.key, locs: m.locations }))
      : tab === 'unused'
        ? report.unused.map((u) => ({ key: u.key, locs: [{ path: u.path, line: u.line }] }))
        : report.duplicates.map((d) => ({ key: d.key, locs: d.locations }));
  const allGood = !report.missing.length && !report.unused.length && !report.duplicates.length;
  return (
    <div className="space-y-3 pb-1">
      <div className="flex items-center gap-2 text-[12.5px] text-fg-muted">
        <span>
          {tr('citedKeys', { count: report.citedCount })} · {tr('bibEntries', { count: report.definedCount })}
        </span>
        {report.nociteAll && <Badge tone="info">\nocite{'{*}'}</Badge>}
      </div>
      {allGood ? (
        <div className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-3 text-[13px] text-success">
          <CheckCircle2 className="size-4" /> {tr('allGood')}
        </div>
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'missing', label: tr('missing', { count: report.missing.length }) },
              { value: 'unused', label: tr('unused', { count: report.unused.length }) },
              { value: 'duplicates', label: tr('duplicates', { count: report.duplicates.length }) },
            ]}
          />
          <p className="text-[12px] text-fg-subtle">
            {tab === 'missing' ? tr('missingHint') : tab === 'unused' ? tr('unusedHint') : tr('duplicatesHint')}
          </p>
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-inset ring-border">
            {!rows.length && <li className="px-3 py-6 text-center text-[12.5px] text-fg-subtle">{tr('nothingHere')}</li>}
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 px-3 py-2">
                {tab === 'missing' ? <AlertCircle className="mt-0.5 size-3.5 text-danger" /> : <CircleDashed className="mt-0.5 size-3.5 text-warning" />}
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12.5px] text-fg">{r.key}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    {r.locs.slice(0, 6).map((l, i) => (
                      <button key={i} className="font-mono text-[11px] text-accent hover:underline" onClick={() => open(l.path, l.line)}>
                        {l.path}:{l.line}
                      </button>
                    ))}
                    {r.locs.length > 6 && <span className="text-[11px] text-fg-subtle">{tr('more', { count: r.locs.length - 6 })}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!!rows.length && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                icon={<CopyIcon />}
                onClick={() => {
                  void navigator.clipboard?.writeText(rows.map((r) => r.key).join(', '));
                  api.ui.toast(tr('keysCopied'), { type: 'success' });
                }}
              >
                {tr('copyKeys')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function checkCitations(api: PluginAPI) {
  const report = await analyzeCitations(api);
  await api.ui.modal({
    title: createTr(api, MESSAGES)('citationCheck'),
    width: 640,
    render: (el, close) => mountReact(el, <CitationReportView api={api} report={report} close={close} />),
  });
}

export default definePlugin({
  id: 'org.texit.bibtex',
  name: 'BibTeX tools',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'book-open',
  description: 'Add references from a DOI, arXiv id or ISBN, format .bib files and find unused or missing citations.',
  permissions: ['project:read', 'project:write', 'editor', 'ui', 'network', 'storage'],
  tags: ['bibliography', 'references', 'citations'],
  locales: {
    es: {
      name: 'Herramientas BibTeX',
      description: 'Añade referencias desde un DOI, un id de arXiv o un ISBN, da formato a archivos .bib y encuentra citas sin usar o faltantes.',
      commands: {
        addReference: 'Añadir referencia desde DOI / arXiv / ISBN…',
        format: 'Dar formato al archivo .bib',
        checkCitations: 'Buscar citas sin usar y faltantes',
      },
      settings: {
        rekey: { title: 'Generar claves de cita', description: 'Usa claves “apellido + año + palabra del título” (p. ej., vaswani2017attention).' },
        insertCite: { title: 'Insertar \\cite{key} después de añadir', description: 'Si no, la clave se copia al portapapeles.' },
        sortEntries: { title: 'Ordenar entradas por clave al dar formato' },
      },
    },
  },
  settings: [
    { key: 'rekey', title: 'Generate citation keys', description: 'Use “lastname + year + title word” keys (e.g. vaswani2017attention).', type: 'boolean', default: true },
    { key: 'insertCite', title: 'Insert \\cite{key} after adding', description: 'Otherwise the key is copied to the clipboard.', type: 'boolean', default: false },
    { key: 'sortEntries', title: 'Sort entries by key when formatting', type: 'boolean', default: false },
  ],
  activate(api) {
    api.commands.register({ id: 'addReference', title: 'Add reference from DOI / arXiv / ISBN…', category: 'BibTeX', icon: 'book-plus', when: 'project', run: () => addReference(api) });
    api.commands.register({ id: 'format', title: 'Format .bib file', category: 'BibTeX', icon: 'wand-sparkles', when: 'project', run: () => formatBibFile(api) });
    api.commands.register({ id: 'checkCitations', title: 'Find unused & missing citations', category: 'BibTeX', icon: 'list-checks', when: 'project', run: () => checkCitations(api) });
  },
});
