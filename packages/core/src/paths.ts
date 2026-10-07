/** POSIX path helpers for project-relative paths. */

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? '' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? n : n.slice(i + 1);
}

/** Extension in lower-case without the dot ('' if none). */
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function stripExtension(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -(ext.length + 1)) : p;
}

const TEXT_EXTENSIONS = new Set([
  'tex', 'latex', 'ltx', 'sty', 'cls', 'clo', 'cfg', 'def', 'dtx', 'ins', 'fd',
  'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dbx', 'bbl', 'aux', 'idx', 'ind', 'ist', 'glo', 'gls', 'nlo', 'nls',
  'txt', 'md', 'markdown', 'rst', 'org', 'csv', 'tsv', 'dat', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css',
  'tikz', 'pgf', 'pgf-plot', 'asy', 'mp', 'gnuplot', 'gp', 'plt',
  'lua', 'py', 'r', 'm', 'jl', 'js', 'ts', 'sh', 'bat', 'c', 'h', 'cpp', 'hpp', 'java', 'rs', 'go', 'hs', 'rb', 'pl', 'sql',
  'latexmkrc', 'gitignore', 'editorconfig', 'log', 'sage', 'typ', 'svg', 'rnw', 'rtex', 'tikzstyles', 'mtx', 'cbx',
]);

const TEXT_FILENAMES = new Set(['latexmkrc', '.latexmkrc', 'makefile', 'readme', 'license', 'copying', '.gitignore']);

/** Whether a path should be stored and edited as text. */
export function isTextPath(p: string): boolean {
  const ext = extname(p);
  if (ext) return TEXT_EXTENSIONS.has(ext);
  return TEXT_FILENAMES.has(basename(p).toLowerCase());
}

export function isTexPath(p: string): boolean {
  const ext = extname(p);
  return ext === 'tex' || ext === 'latex' || ext === 'ltx';
}

export function isImagePath(p: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(extname(p));
}

export function isPdfPath(p: string): boolean {
  return extname(p) === 'pdf';
}

/** Generate a non-colliding path by appending " (n)" before the extension. */
export function uniquePath(path: string, exists: (p: string) => boolean): string {
  if (!exists(path)) return path;
  const dir = dirname(path);
  const ext = extname(path);
  const stem = stripExtension(basename(path));
  for (let n = 2; ; n++) {
    const candidate = joinPath(dir, `${stem} (${n})${ext ? '.' + ext : ''}`);
    if (!exists(candidate)) return candidate;
  }
}

/** Resolve a path referenced from inside a file (e.g. \input{..}) to a project-relative path. */
export function resolveRelative(fromFile: string, ref: string): string {
  if (ref.startsWith('/')) return normalizePath(ref);
  // LaTeX resolves \input relative to the main file's directory (the cwd), not the including file.
  // Callers that know the main file dir should pass it via `fromFile`.
  return joinPath(dirname(fromFile), ref);
}
