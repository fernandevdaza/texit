/**
 * Which files of a project folder are not part of the project (VCS metadata,
 * dependencies, OS junk and LaTeX build artefacts). Pure, unit tested.
 */

const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.texit', '.idea', '.vscode-test', '__pycache__', '_minted', 'svg-inkscape', '.DS_Store']);

const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.texit-sources.json']);

/** LaTeX auxiliary / build outputs (matched on the lower-cased file name). */
const BUILD_SUFFIXES = [
  '.aux', '.log', '.out', '.toc', '.lof', '.lot', '.loa', '.lol', '.fls', '.fdb_latexmk', '.synctex.gz', '.synctex', '.synctex(busy)',
  '.synctex.gz(busy)', '.blg', '.bcf', '.run.xml', '.idx', '.ilg', '.ind', '.nav', '.snm', '.vrb', '.xdv', '.dvi', '.glg', '.glo', '.gls',
  '.glsdefs', '.acn', '.acr', '.alg', '.ist.bak', '.thm', '.maf', '.brf', '.figlist', '.makefile', '.auxlock', '.ptc', '.tdo', '.pyg',
  '.listing', '.nlo', '.nls', '.upa', '.upb', '.xref', '.4ct', '.4tc', '.idv', '.lg', '.tmp', '.swp', '~',
];

/** `rel` is a POSIX path relative to the project root. */
export function isIgnoredPath(rel: string): boolean {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return false;
  for (let i = 0; i < parts.length - 1; i++) if (isIgnoredDir(parts[i])) return true;
  const name = parts[parts.length - 1];
  const lower = name.toLowerCase();
  if (IGNORED_DIRS.has(name) || IGNORED_FILES.has(lower)) return true;
  if (lower.startsWith('.#') || lower.startsWith('~$')) return true; // editor lock files
  if (/\.mtc\d*$|\.maf$|\.stc\d*$/.test(lower)) return true;
  return BUILD_SUFFIXES.some((s) => lower.endsWith(s));
}

/** Whether a directory name is skipped entirely while walking. */
export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith('_minted-');
}
