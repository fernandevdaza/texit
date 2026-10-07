/**
 * PluginHost — builds the `PluginAPI` object handed to one plugin.
 *
 *  - Every registration is tracked in a scoped disposable list, so disabling /
 *    uninstalling / reloading a plugin removes everything it contributed.
 *  - Commands, panels, status items and templates are namespaced
 *    `<pluginId>.<id>` and tagged with `pluginId`.
 *  - Every plugin callback is wrapped: errors are reported through `onError`
 *    (toast + "errored" badge) instead of propagating into the app.
 *  - Third-party plugins only get the APIs their approved permissions allow.
 */
import { icons, type LucideIcon } from 'lucide-react';
import type { Disposable } from '@texit/core';
import { normalizePath } from '@texit/core';
import {
  PLUGIN_API_VERSION,
  type AIToolDef,
  type CompileBackend,
  type CompletionSourceDef,
  type EditorSelection,
  type PanelContext,
  type PanelDef,
  type PluginAPI,
  type PluginManifest,
  type PluginPermission,
  type QuickPickItem,
  type Snippet,
  type StatusItemDef,
  type StatusItemHandle,
} from '@texit/plugin-api';
import { registerCommand, executeCommand, useCommands } from '@/services/commands';
import { registerPanel, registerStatusItem, usePanelRegistry, type PanelLocation } from '@/services/panels';
import { contributeEditorExtension, getEditorBridge, selectionChanged, type EditorSelectionInfo } from '@/services/editor';
import { getCompileController } from '@/services/compile';
import { getAiBridge } from '@/services/ai';
import { registerTemplate } from '@/services/templates';
import { useLayout, useWorkspace } from '@/state/workspace';
import { useResolvedTheme } from '@/state/settings';
import { latexApi } from './latexApi';
import { completionSourceExtension, snippetsExtension } from './completion';
import { createStatusItemComponent } from './StatusItem';
import type { PluginSettingsHandle } from './settingsStore';

/** UI services injected by the app (or by tests). */
export interface HostUi {
  toast(message: string, opts?: { type?: 'info' | 'success' | 'error' | 'warning'; description?: string }): void;
  quickPick<T>(items: QuickPickItem<T>[], opts?: { placeholder?: string; title?: string }): Promise<T | undefined>;
  prompt(opts: { title: string; placeholder?: string; value?: string }): Promise<string | undefined>;
  confirm(opts: { title: string; message?: string; danger?: boolean }): Promise<boolean>;
  modal(opts: {
    title: string;
    width?: number;
    render(container: HTMLElement, close: () => void): void | (() => void);
    onError(err: unknown): void;
  }): Promise<void>;
}

export interface HostStorage {
  get<T>(pluginId: string, key: string): Promise<T | undefined>;
  set(pluginId: string, key: string, value: unknown): Promise<void>;
  delete(pluginId: string, key: string): Promise<void>;
}

export interface PluginHostOptions {
  manifest: PluginManifest;
  /** Built-ins are trusted: all permissions granted. */
  trusted: boolean;
  /** Permissions the user approved (third-party plugins). */
  granted: PluginPermission[];
  ui: HostUi;
  storage: HostStorage;
  settings: PluginSettingsHandle;
  /** Called for every error thrown by plugin code (already isolated). */
  onError(err: unknown, context: string): void;
  /** Poll interval used while waiting for late bridges (compile / AI). */
  bridgePollMs?: number;
}

export interface PluginHostHandle {
  readonly api: PluginAPI;
  readonly disposed: boolean;
  /** Track an extra disposable (e.g. the one returned by `activate`). */
  track(d: Disposable | (() => void)): void;
  /** Number of live registrations (for diagnostics/tests). */
  size(): number;
  dispose(): void;
}

export class PluginPermissionError extends Error {
  constructor(
    readonly pluginName: string,
    readonly permission: PluginPermission,
    what: string,
  ) {
    super(`"${pluginName}" needs the "${permission}" permission to use ${what}.`);
    this.name = 'PluginPermissionError';
  }
}

/** Permissions the host actually enforces (others are declarative: shown on install). */
export const ENFORCED_PERMISSIONS: PluginPermission[] = ['project:read', 'project:write', 'editor', 'compiler', 'ai'];

/** Fully-qualified contribution id: `<pluginId>.<id>`. */
export function qualifyId(pluginId: string, id: string): string {
  return id.startsWith(`${pluginId}.`) ? id : `${pluginId}.${id}`;
}

export function lucideByName(name?: string): LucideIcon | undefined {
  if (!name || name.trim().startsWith('<')) return undefined;
  const pascal = name.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase()) as keyof typeof icons;
  return icons[pascal];
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

export function createPluginHost(opts: PluginHostOptions): PluginHostHandle {
  const { manifest, ui, onError } = opts;
  const pluginId = manifest.id;
  const name = manifest.name;
  const pollMs = opts.bridgePollMs ?? 1000;
  let disposed = false;
  const disposables = new Set<Disposable>();
  const warned = new Set<string>();

  const warnOnce = (key: string, msg: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[plugin ${pluginId}] ${msg}`);
  };

  /** Track a disposable; removing it from the set when disposed individually. */
  function track(d: Disposable | (() => void)): Disposable {
    const inner: Disposable = typeof d === 'function' ? { dispose: d } : d;
    if (disposed) {
      // Late registration from async code after disable: undo immediately.
      warnOnce('late', 'registration after the plugin was disabled was ignored');
      try {
        inner.dispose();
      } catch {
        /* ignore */
      }
      return { dispose() {} };
    }
    let done = false;
    const wrapped: Disposable = {
      dispose() {
        if (done) return;
        done = true;
        disposables.delete(wrapped);
        try {
          inner.dispose();
        } catch (err) {
          console.error(`[plugin ${pluginId}] dispose failed`, err);
        }
      },
    };
    disposables.add(wrapped);
    return wrapped;
  }

  /** Run plugin code synchronously, isolating errors. */
  function run<T>(fn: () => T, context: string): T | undefined {
    if (disposed) return undefined;
    try {
      const r = fn();
      if (isPromiseLike(r)) {
        return Promise.resolve(r).catch((err) => {
          onError(err, context);
          return undefined;
        }) as T;
      }
      return r;
    } catch (err) {
      onError(err, context);
      return undefined;
    }
  }

  /** Wrap a plugin callback: errors are reported and swallowed. */
  function guard<A extends unknown[], R>(fn: (...a: A) => R, context: string): (...a: A) => R | undefined {
    return (...args: A) => run(() => fn(...args), context);
  }

  /** Wrap a plugin callback: errors are reported *and* rethrown (AI tools, backends). */
  function guardRethrow<A extends unknown[], R>(fn: (...a: A) => R, context: string): (...a: A) => R {
    return (...args: A) => {
      try {
        const r = fn(...args);
        if (isPromiseLike(r)) {
          return Promise.resolve(r).catch((err) => {
            onError(err, context);
            throw err;
          }) as R;
        }
        return r;
      } catch (err) {
        onError(err, context);
        throw err;
      }
    };
  }

  function need(permission: PluginPermission, what: string) {
    if (opts.trusted) return;
    const g = opts.granted;
    if (g.includes(permission)) return;
    if (permission === 'project:read' && g.includes('project:write')) return;
    throw new PluginPermissionError(name, permission, what);
  }

  /** Attach to a bridge that may be registered later (compile / AI features). */
  function lazyAttach<B>(get: () => B | null, attach: (b: B) => Disposable, what: string): Disposable {
    const now = get();
    if (now) return track(attach(now));
    warnOnce(`lazy:${what}`, `${what} is not available yet — the registration will attach when it is.`);
    let inner: Disposable | null = null;
    const timer = setInterval(() => {
      const b = get();
      if (!b || disposed) return;
      clearInterval(timer);
      inner = attach(b);
    }, pollMs);
    return track(() => {
      clearInterval(timer);
      inner?.dispose();
    });
  }

  const project = () => useWorkspace.getState().project;
  const requireProject = () => {
    const p = project();
    if (!p) throw new Error('No project is open.');
    return p;
  };
  const activePath = (): string | null => {
    const ws = useWorkspace.getState();
    if (!ws.activeFileId || !ws.project?.has(ws.activeFileId)) return null;
    return ws.project.getPath(ws.activeFileId);
  };
  const toSelection = (s: EditorSelectionInfo | null): EditorSelection | null =>
    s ? { path: s.path, from: s.from, to: s.to, text: s.text, line: s.line } : null;

  let extSeq = 0;

  const api: PluginAPI = {
    apiVersion: PLUGIN_API_VERSION,
    plugin: Object.freeze({ ...manifest }),

    commands: {
      register(cmd) {
        const id = qualifyId(pluginId, cmd.id);
        const when =
          cmd.when === 'project'
            ? () => !!useWorkspace.getState().project
            : cmd.when === 'editor'
              ? () => !!useWorkspace.getState().activeFileId && !!getEditorBridge()
              : undefined;
        return track(
          registerCommand({
            id,
            title: cmd.title,
            category: cmd.category ?? name,
            icon: lucideByName(cmd.icon ?? manifest.icon),
            keybinding: cmd.keybinding,
            global: !!cmd.keybinding,
            when,
            keywords: [name, pluginId],
            run: guard((...args: unknown[]) => cmd.run(...args), `command "${id}"`),
          }),
        );
      },
      async execute(id, ...args) {
        const all = useCommands.getState().commands;
        const target = all[id] ? id : all[qualifyId(pluginId, id)] ? qualifyId(pluginId, id) : id;
        return executeCommand(target, ...args);
      },
    },

    ui: {
      registerPanel(def: PanelDef) {
        const id = qualifyId(pluginId, def.id);
        // Right-dock panels are hosted in the sidebar until the workspace has a right dock.
        const location: PanelLocation = def.location === 'bottom' ? 'bottom' : 'sidebar';
        const ctx: PanelContext = {
          api,
          get theme() {
            return useResolvedTheme.getState().theme;
          },
          onThemeChange: (cb) => api.ui.onThemeChange(cb),
        };
        return track(
          registerPanel({
            id,
            title: def.title,
            location,
            icon: def.icon ?? manifest.icon,
            order: 70,
            pluginId,
            render: (el) => {
              let cleanup: void | (() => void) = undefined;
              try {
                cleanup = disposed ? undefined : def.render(el, ctx);
              } catch (err) {
                onError(err, `panel "${id}"`);
                el.innerHTML = '';
                const msg = document.createElement('div');
                msg.style.cssText = 'padding:16px;font-size:12px;color:var(--tx-danger)';
                msg.textContent = `This panel failed to render: ${err instanceof Error ? err.message : String(err)}`;
                el.append(msg);
              }
              return () => {
                if (typeof cleanup === 'function') run(cleanup, `panel "${id}" cleanup`);
              };
            },
          }),
        );
      },
      registerStatusItem(def: StatusItemDef): StatusItemHandle {
        const id = qualifyId(pluginId, def.id);
        const { component, refresh } = createStatusItemComponent(def, api, run);
        const d = track(
          registerStatusItem({ id, align: def.align ?? 'right', order: 60 - (def.priority ?? 0), component, pluginId }),
        );
        return { dispose: () => d.dispose(), refresh };
      },
      showPanel(id) {
        const panels = usePanelRegistry.getState().panels;
        const p = panels.find((x) => x.id === qualifyId(pluginId, id)) ?? panels.find((x) => x.id === id);
        if (!p) return warnOnce(`panel:${id}`, `showPanel: unknown panel "${id}"`);
        const layout = useLayout.getState();
        if (p.location === 'bottom') layout.showBottomPanel(p.id);
        else {
          if (layout.focusMode !== 'none') layout.set({ focusMode: 'none' });
          layout.showSidebarPanel(p.id);
        }
      },
      getTheme: () => useResolvedTheme.getState().theme,
      onThemeChange(cb) {
        const safe = guard(cb, 'theme listener');
        return track(useResolvedTheme.subscribe((s, p) => s.theme !== p.theme && safe(s.theme)));
      },
      toast(message, o) {
        ui.toast(String(message), o);
      },
      quickPick(items, o) {
        return ui.quickPick(items, o);
      },
      prompt(o) {
        return ui.prompt(o);
      },
      confirm(o) {
        return ui.confirm(o);
      },
      modal(o) {
        return ui.modal({ ...o, onError: (err) => onError(err, `modal "${o.title}"`) });
      },
    },

    editor: {
      getActivePath: () => activePath(),
      getSelection() {
        need('editor', 'editor.getSelection');
        return toSelection(getEditorBridge()?.getSelection() ?? null);
      },
      replaceSelection(text) {
        need('editor', 'editor.replaceSelection');
        const b = getEditorBridge();
        if (!b) return warnOnce('editor', 'no editor is open');
        b.replaceSelection(text);
      },
      insertText(text) {
        need('editor', 'editor.insertText');
        const b = getEditorBridge();
        if (!b) return warnOnce('editor', 'no editor is open');
        b.insertText(text);
      },
      wrapSelection(before, after) {
        need('editor', 'editor.wrapSelection');
        const b = getEditorBridge();
        if (!b) return warnOnce('editor', 'no editor is open');
        b.wrapSelection(before, after);
      },
      focus() {
        getEditorBridge()?.focus();
      },
      open(path, line) {
        const ws = useWorkspace.getState();
        const p = ws.project;
        if (!p) return;
        const id = p.findByPath(normalizePath(path));
        if (!id) return warnOnce(`open:${path}`, `editor.open: file not found "${path}"`);
        if (line && line > 0) ws.revealLocation(id, line);
        else ws.openFile(id);
      },
      registerSnippets(snippets: Snippet[]) {
        const ext = snippetsExtension(snippets, activePath, name);
        return track(contributeEditorExtension(`plugin:${pluginId}:snippets:${++extSeq}`, ext));
      },
      registerCompletionSource(def: CompletionSourceDef) {
        const id = qualifyId(pluginId, def.id);
        const provide = async (ctx: Parameters<CompletionSourceDef['provide']>[0]) =>
          (await run(() => def.provide(ctx), `completion source "${id}"`)) ?? null;
        const ext = completionSourceExtension(def, activePath, name, provide);
        return track(contributeEditorExtension(`plugin:${id}`, ext));
      },
      onDidChangeActiveFile(cb) {
        const safe = guard(cb, 'onDidChangeActiveFile listener');
        return track(
          useWorkspace.subscribe((s, p) => {
            if (s.activeFileId !== p.activeFileId) safe(activePath());
          }),
        );
      },
      onDidChangeSelection(cb) {
        need('editor', 'editor.onDidChangeSelection');
        const safe = guard(cb, 'onDidChangeSelection listener');
        return track(selectionChanged.on((s) => safe(toSelection(s))));
      },
    },

    project: {
      getName: () => useWorkspace.getState().meta?.name ?? project()?.getMeta().name ?? '',
      getMainPath() {
        const p = project();
        const id = p?.getMainFileId();
        return p && id ? p.getPath(id) : null;
      },
      listFiles() {
        need('project:read', 'project.listFiles');
        return (project()?.listFiles() ?? []).map((f) => ({ path: f.path, isText: f.isText, size: f.size }));
      },
      async readFile(path) {
        need('project:read', 'project.readFile');
        return project()?.readPath(normalizePath(path)) ?? null;
      },
      async writeFile(path, content) {
        need('project:write', 'project.writeFile');
        const p = requireProject();
        const norm = normalizePath(path);
        if (!norm) throw new Error('Invalid path');
        const id = p.findByPath(norm);
        if (id && p.getNode(id)?.kind === 'file') p.writeFile(id, content);
        else p.createFile(norm, content);
      },
      async deleteFile(path) {
        need('project:write', 'project.deleteFile');
        const p = requireProject();
        const id = p.findByPath(normalizePath(path));
        if (!id) throw new Error(`File not found: ${path}`);
        p.delete(id);
      },
      onDidChangeFiles(cb) {
        need('project:read', 'project.onDidChangeFiles');
        const safe = guard(() => cb(), 'onDidChangeFiles listener');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fire = () => {
          clearTimeout(timer);
          timer = setTimeout(safe, 250);
        };
        let detach: (() => void) | undefined;
        const attach = () => {
          detach?.();
          const p = project();
          if (!p) return (detach = undefined);
          const a = p.onTreeChange(fire);
          const b = p.onContentChange(fire);
          detach = () => {
            a();
            b();
          };
        };
        attach();
        const unsub = useWorkspace.subscribe((s, prev) => {
          if (s.project !== prev.project) {
            attach();
            fire();
          }
        });
        return track(() => {
          clearTimeout(timer);
          unsub();
          detach?.();
        });
      },
    },

    compiler: {
      async compile() {
        need('compiler', 'compiler.compile');
        const c = getCompileController();
        if (!c) {
          warnOnce('compiler', 'the compiler is not available');
          return null;
        }
        return (await c.compile({ reason: 'plugin' })) as any;
      },
      registerBackend(backend: CompileBackend) {
        need('compiler', 'compiler.registerBackend');
        // Proxy (not a spread) so class-based backends keep prototype methods and
        // optional members (prepareFor, onStatusChange, dispose…) are forwarded.
        // Async entry points are bound to the original object and error-isolated.
        const isolated = new Set(['status', 'prepare', 'prepareFor', 'compile']);
        const wrapped = new Proxy(backend, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            const bound = (value as (...a: unknown[]) => unknown).bind(target);
            return typeof prop === 'string' && isolated.has(prop) ? guardRethrow(bound, `backend "${target.id}" ${prop}`) : bound;
          },
        });
        return lazyAttach(getCompileController, (c) => c.registerBackend(wrapped as any), 'The compiler');
      },
      onWillCompile(cb) {
        need('compiler', 'compiler.onWillCompile');
        const safe = guard(cb, 'onWillCompile hook');
        return lazyAttach(getCompileController, (c) => c.onWillCompile((files) => safe(files) as any), 'The compiler');
      },
      onDidCompile(cb) {
        need('compiler', 'compiler.onDidCompile');
        const safe = guard(cb, 'onDidCompile listener');
        return lazyAttach(getCompileController, (c) => c.onDidCompile((r) => void safe(r as any)), 'The compiler');
      },
      getLastResult() {
        need('compiler', 'compiler.getLastResult');
        return (getCompileController()?.getLastResult() ?? null) as any;
      },
    },

    ai: {
      registerTool(tool: AIToolDef) {
        need('ai', 'ai.registerTool');
        const wrapped: AIToolDef = { ...tool, execute: guardRethrow((input) => tool.execute(input), `AI tool "${tool.name}"`) };
        return lazyAttach(getAiBridge, (b) => b.registerTool(wrapped), 'The AI assistant');
      },
      async complete(prompt, o) {
        need('ai', 'ai.complete');
        const b = getAiBridge();
        if (!b) throw new Error('The AI assistant is not available.');
        return b.complete(prompt, o);
      },
    },

    templates: {
      register(t) {
        return track(registerTemplate({ ...t, id: qualifyId(pluginId, t.id) }));
      },
    },

    settings: {
      get: (key, fallback) => opts.settings.get(key, fallback),
      set: (key, value) => opts.settings.set(key, value),
      onDidChange(cb) {
        const safe = guard(cb, 'settings listener');
        return track(opts.settings.onDidChange((k, v) => safe(k, v)));
      },
    },

    storage: {
      get: (key) => opts.storage.get(pluginId, key),
      set: (key, value) => opts.storage.set(pluginId, key, value),
      delete: (key) => opts.storage.delete(pluginId, key),
    },

    latex: latexApi,
  };

  return {
    api,
    get disposed() {
      return disposed;
    },
    track(d) {
      track(d);
    },
    size: () => disposables.size,
    dispose() {
      if (disposed) return;
      // Dispose in reverse registration order.
      for (const d of Array.from(disposables).reverse()) d.dispose();
      disposables.clear();
      disposed = true;
    },
  };
}
