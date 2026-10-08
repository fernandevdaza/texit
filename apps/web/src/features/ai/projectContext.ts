/**
 * `ProjectToolContext` implemented against the live workspace (ProjectDoc / Y.Doc,
 * compile controller, editor bridge). Text writes use minimal Y.Text operations so
 * collaborators' cursors and concurrent edits survive.
 */
import type { ProjectToolContext } from '@texit/ai';
import { basename, dirname, normalizePath, type ProjectDoc } from '@texit/core';
import { getCompileController } from '@/services/compile';
import { getEditorBridge } from '@/services/editor';
import { useWorkspace } from '@/state/workspace';
import { confirmDialog } from '@/ui';
import { t } from '@/lib/i18n';

export interface WorkspaceContextOptions {
  reviewEdit?: (path: string, before: string, after: string) => Promise<boolean>;
  /** Ask before deleting / renaming (only used when edits are not auto-applied). */
  confirm?: boolean;
}

function project(): ProjectDoc {
  const p = useWorkspace.getState().project;
  if (!p) throw new Error('No project is open.');
  return p;
}

function fileId(p: ProjectDoc, path: string): string | null {
  const id = p.findByPath(normalizePath(path));
  if (!id) return null;
  return p.getNode(id)?.kind === 'file' ? id : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mainPath(): string | null {
  const p = useWorkspace.getState().project;
  if (!p) return null;
  const id = p.getMainFileId() ?? p.detectMainFile();
  return id ? p.getPath(id) : null;
}

/** Active file + selection from the editor bridge (falls back to the active tab). */
export function activeFileInfo(): ReturnType<ProjectToolContext['getActiveFile']> {
  const sel = getEditorBridge()?.getSelection();
  if (sel) {
    const view = getEditorBridge()?.getView();
    const line = view ? view.state.doc.lineAt(Math.min(sel.from, view.state.doc.length)).number : sel.line;
    return { path: sel.path, selection: { from: sel.from, to: sel.to, text: sel.text, line } };
  }
  const ws = useWorkspace.getState();
  if (ws.project && ws.activeFileId && ws.project.has(ws.activeFileId)) return { path: ws.project.getPath(ws.activeFileId) };
  return null;
}

export function createWorkspaceToolContext(opts: WorkspaceContextOptions = {}): ProjectToolContext {
  return {
    listFiles() {
      return project()
        .listFiles()
        .map((f) => ({ path: f.path, isText: f.isText, size: f.size }));
    },
    async readFile(path) {
      const p = project();
      const id = fileId(p, path);
      return id ? p.readText(id) : null;
    },
    async writeFile(path, content) {
      project().createFile(normalizePath(path), content);
    },
    async deleteFile(path) {
      const p = project();
      const id = fileId(p, path);
      if (!id) throw new Error(`No such file: ${path}`);
      p.delete(id);
    },
    async renameFile(from, to) {
      const p = project();
      const id = fileId(p, from);
      if (!id) throw new Error(`No such file: ${from}`);
      const target = normalizePath(to);
      p.doc.transact(() => {
        if (dirname(target) !== dirname(normalizePath(from))) p.move(id, p.ensureFolder(dirname(target)));
        if (basename(target) !== basename(from)) p.rename(id, basename(target));
      });
    },
    async editFile(path, search, replace, o) {
      const p = project();
      const id = fileId(p, path);
      if (!id) throw new Error(`No such file: ${path}`);
      const yt = p.getYText(id);
      if (!yt) throw new Error(`${path} is not a text file`);
      const text = yt.toString();
      const hits: number[] = [];
      for (let i = text.indexOf(search); i !== -1 && search; i = text.indexOf(search, i + search.length)) hits.push(i);
      if (!hits.length) throw new Error('search text not found');
      if (hits.length > 1 && !o?.replaceAll) throw new Error(`search text found ${hits.length} times`);
      p.doc.transact(() => {
        for (const at of [...hits].reverse()) {
          // Keep the common prefix/suffix untouched (smallest possible CRDT change).
          let s = 0;
          while (s < search.length && s < replace.length && search[s] === replace[s]) s++;
          let e = 0;
          while (e < search.length - s && e < replace.length - s && search[search.length - 1 - e] === replace[replace.length - 1 - e]) e++;
          const delLen = search.length - s - e;
          if (delLen > 0) yt.delete(at + s, delLen);
          const ins = replace.slice(s, replace.length - e);
          if (ins) yt.insert(at + s, ins);
        }
      });
    },
    async search(query, o) {
      const p = project();
      let re: RegExp;
      try {
        re = new RegExp(o?.regex ? query : escapeRegExp(query), o?.caseSensitive ? '' : 'i');
      } catch (e) {
        throw new Error(`Invalid regular expression: ${(e as Error).message}`);
      }
      const out: { path: string; line: number; text: string }[] = [];
      for (const f of p.listFiles()) {
        if (!f.isText) continue;
        const lines = p.readText(f.id).split(/\r?\n/);
        lines.forEach((line, i) => {
          if (out.length < 2000 && re.test(line)) out.push({ path: f.path, line: i + 1, text: line });
        });
      }
      return out;
    },
    async compile() {
      const c = getCompileController();
      if (!c) {
        return {
          status: 'unavailable',
          diagnostics: useWorkspace.getState().compile.diagnostics,
          logTail: 'The compiler is not available in this session yet; diagnostics are from the last compile (if any).',
        };
      }
      const res = (await c.compile({ reason: 'ai' })) ?? c.getLastResult();
      if (!res) return { status: 'busy', diagnostics: useWorkspace.getState().compile.diagnostics, logTail: '' };
      return { status: res.status, diagnostics: res.diagnostics ?? [], logTail: (res.log ?? '').slice(-6000) };
    },
    getDiagnostics() {
      return useWorkspace.getState().compile.diagnostics;
    },
    getMainPath: mainPath,
    getActiveFile: activeFileInfo,
    reviewEdit: opts.reviewEdit,
    confirmAction: opts.confirm
      ? (a) =>
          confirmDialog({
            title: a.kind === 'delete' ? t('ai.confirm.deleteTitle', { path: a.path }) : t('ai.confirm.renameTitle', { path: a.path }),
            message: a.kind === 'delete' ? t('ai.confirm.deleteMessage') : t('ai.confirm.renameMessage', { newPath: a.newPath }),
            confirmLabel: a.kind === 'delete' ? t('common.delete') : t('common.rename'),
            danger: a.kind === 'delete',
          })
      : undefined,
  };
}
