import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@texit/plugin-api';
import { useCommands, executeCommand } from '@/services/commands';
import { usePanelRegistry } from '@/services/panels';
import { getContributedExtensions } from '@/services/editor';
import { useTemplates } from '@/services/templates';
import { setCompileController, type CompileController } from '@/services/compile';
import { createPluginHost, qualifyId, PluginPermissionError, type HostUi } from './host';
import { PluginSettingsHandle } from './settingsStore';
import { isApiCompatible, extractPlugin } from './loader';

const ui: HostUi = {
  toast: vi.fn(),
  quickPick: vi.fn(async () => undefined),
  prompt: vi.fn(async () => undefined),
  confirm: vi.fn(async () => false),
  modal: vi.fn(async () => undefined),
};

function memoryStorage() {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(id: string, k: string) => m.get(`${id}:${k}`) as T | undefined,
    set: async (id: string, k: string, v: unknown) => void m.set(`${id}:${k}`, v),
    delete: async (id: string, k: string) => void m.delete(`${id}:${k}`),
    m,
  };
}

function makeHost(manifest: Partial<PluginManifest> = {}, opts: { trusted?: boolean; granted?: PluginManifest['permissions'] } = {}) {
  const m: PluginManifest = { id: 'com.test.plugin', name: 'Test plugin', version: '1.0.0', ...manifest };
  const onError = vi.fn();
  const settings = new PluginSettingsHandle(m.id, m);
  const storage = memoryStorage();
  const host = createPluginHost({
    manifest: m,
    trusted: opts.trusted ?? true,
    granted: opts.granted ?? [],
    ui,
    storage,
    settings,
    onError,
    bridgePollMs: 10,
  });
  return { host, api: host.api, onError, settings, storage };
}

const pluginCommands = () => Object.keys(useCommands.getState().commands).filter((id) => id.startsWith('com.test.plugin'));
const pluginPanels = () => usePanelRegistry.getState().panels.filter((p) => p.pluginId === 'com.test.plugin');
const pluginStatus = () => usePanelRegistry.getState().statusItems.filter((p) => p.pluginId === 'com.test.plugin');

afterEach(() => {
  vi.clearAllMocks();
});

describe('plugin host namespacing', () => {
  it('qualifies contribution ids without double prefixing', () => {
    expect(qualifyId('a.b', 'run')).toBe('a.b.run');
    expect(qualifyId('a.b', 'a.b.run')).toBe('a.b.run');
  });

  it('namespaces and tags every contribution', () => {
    const { host, api } = makeHost();
    api.commands.register({ id: 'hello', title: 'Hello', run: () => 42 });
    api.ui.registerPanel({ id: 'panel', title: 'Panel', location: 'sidebar', render: () => {} });
    api.ui.registerStatusItem({ id: 'status', render: () => ({ text: 'hi' }) });
    api.templates.register({ id: 'tpl', name: 'T', description: '', category: 'other', engine: 'pdflatex', main: 'main.tex', files: [] });

    expect(pluginCommands()).toEqual(['com.test.plugin.hello']);
    expect(useCommands.getState().commands['com.test.plugin.hello'].category).toBe('Test plugin');
    expect(pluginPanels().map((p) => p.id)).toEqual(['com.test.plugin.panel']);
    expect(pluginStatus().map((p) => p.id)).toEqual(['com.test.plugin.status']);
    expect(useTemplates.getState().templates.some((t) => t.id === 'com.test.plugin.tpl')).toBe(true);
    host.dispose();
  });

  it('executes its own commands by short id', async () => {
    const { host, api } = makeHost();
    api.commands.register({ id: 'answer', title: 'Answer', run: (x) => `got ${x}` });
    await expect(api.commands.execute('answer', 7)).resolves.toBe('got 7');
    await expect(executeCommand('com.test.plugin.answer', 1)).resolves.toBe('got 1');
    host.dispose();
  });
});

describe('plugin host disposal', () => {
  it('removes everything the plugin registered', () => {
    const { host, api } = makeHost();
    const before = getContributedExtensions().length;
    api.commands.register({ id: 'a', title: 'A', run: () => {} });
    api.commands.register({ id: 'b', title: 'B', run: () => {} });
    api.ui.registerPanel({ id: 'p', title: 'P', location: 'bottom', render: () => {} });
    api.ui.registerStatusItem({ id: 's', render: () => null });
    api.editor.registerSnippets([{ label: 'fig', template: '\\begin{figure}${1}\\end{figure}' }]);
    api.editor.registerCompletionSource({ id: 'cite', trigger: /\\cite\{([^}]*)/, provide: () => [] });
    api.editor.onDidChangeActiveFile(() => {});
    api.project.onDidChangeFiles(() => {});
    api.ui.onThemeChange(() => {});
    api.settings.onDidChange(() => {});
    api.templates.register({ id: 't', name: 'T', description: '', category: 'other', engine: 'pdflatex', main: 'main.tex', files: [] });
    expect(getContributedExtensions().length).toBe(before + 2);
    expect(host.size()).toBe(11);

    host.dispose();

    expect(host.size()).toBe(0);
    expect(host.disposed).toBe(true);
    expect(pluginCommands()).toEqual([]);
    expect(pluginPanels()).toEqual([]);
    expect(pluginStatus()).toEqual([]);
    expect(getContributedExtensions().length).toBe(before);
    expect(useTemplates.getState().templates.some((t) => t.id.startsWith('com.test.plugin'))).toBe(false);
  });

  it('disposing a single registration only removes that one', () => {
    const { host, api } = makeHost();
    const a = api.commands.register({ id: 'a', title: 'A', run: () => {} });
    api.commands.register({ id: 'b', title: 'B', run: () => {} });
    a.dispose();
    a.dispose(); // idempotent
    expect(pluginCommands()).toEqual(['com.test.plugin.b']);
    expect(host.size()).toBe(1);
    host.dispose();
  });

  it('ignores registrations made after disposal (late async code)', () => {
    const { host, api } = makeHost();
    host.dispose();
    const d = api.commands.register({ id: 'late', title: 'Late', run: () => {} });
    expect(pluginCommands()).toEqual([]);
    expect(() => d.dispose()).not.toThrow();
  });

  it('disposes the disposable returned from activate (tracked)', () => {
    const { host } = makeHost();
    const dispose = vi.fn();
    host.track({ dispose });
    host.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('a later plugin with the same command id does not lose its command when the first is disposed', () => {
    const one = makeHost();
    one.api.commands.register({ id: 'x', title: 'X1', run: () => 1 });
    const two = makeHost();
    two.api.commands.register({ id: 'x', title: 'X2', run: () => 2 });
    one.host.dispose();
    expect(useCommands.getState().commands['com.test.plugin.x']?.title).toBe('X2');
    two.host.dispose();
  });
});

describe('error isolation', () => {
  it('reports errors from commands instead of throwing', async () => {
    const { host, api, onError } = makeHost();
    api.commands.register({ id: 'boom', title: 'Boom', run: () => { throw new Error('kaboom'); } });
    await expect(executeCommand('com.test.plugin.boom')).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom' }), expect.stringContaining('boom'));
    host.dispose();
  });

  it('reports rejected promises from async commands', async () => {
    const { host, api, onError } = makeHost();
    api.commands.register({ id: 'async', title: 'Async', run: async () => { throw new Error('later'); } });
    await expect(executeCommand('com.test.plugin.async')).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    host.dispose();
  });

  it('renders an error message when a panel throws', () => {
    const { host, api, onError } = makeHost();
    api.ui.registerPanel({ id: 'bad', title: 'Bad', location: 'sidebar', render: () => { throw new Error('no render'); } });
    const panel = pluginPanels()[0];
    const el = { innerHTML: 'x', append: vi.fn() } as unknown as HTMLElement;
    const fakeDoc = { createElement: () => ({ style: {}, textContent: '' }) };
    vi.stubGlobal('document', fakeDoc);
    const cleanup = panel.render!(el);
    expect(onError).toHaveBeenCalledOnce();
    expect((el.append as any).mock.calls.length).toBe(1);
    expect(() => typeof cleanup === 'function' && cleanup()).not.toThrow();
    vi.unstubAllGlobals();
    host.dispose();
  });
});

describe('permissions', () => {
  it('blocks gated APIs for untrusted plugins without the permission', async () => {
    const { host, api } = makeHost({}, { trusted: false, granted: [] });
    expect(() => api.project.listFiles()).toThrow(PluginPermissionError);
    await expect(api.project.writeFile('a.tex', 'x')).rejects.toBeInstanceOf(PluginPermissionError);
    expect(() => api.editor.insertText('x')).toThrow(PluginPermissionError);
    await expect(api.ai.complete('hi')).rejects.toBeInstanceOf(PluginPermissionError);
    // Ungated APIs keep working.
    expect(() => api.commands.register({ id: 'ok', title: 'OK', run: () => {} })).not.toThrow();
    host.dispose();
  });

  it('project:write implies project:read', () => {
    const { host, api } = makeHost({}, { trusted: false, granted: ['project:write'] });
    expect(api.project.listFiles()).toEqual([]); // no project open
    host.dispose();
  });
});

describe('settings & storage', () => {
  it('falls back to manifest defaults and notifies listeners', () => {
    const { host, api } = makeHost({ settings: [{ key: 'wpm', title: 'WPM', type: 'number', default: 230 }] });
    expect(api.settings.get('wpm')).toBe(230);
    expect(api.settings.get('missing', 'fb')).toBe('fb');
    const seen: unknown[] = [];
    api.settings.onDidChange((k, v) => seen.push([k, v]));
    api.settings.set('wpm', 300);
    expect(api.settings.get('wpm')).toBe(300);
    expect(seen).toEqual([['wpm', 300]]);
    host.dispose();
    api.settings.set('wpm', 100);
    expect(seen).toHaveLength(1); // listener removed on dispose
  });

  it('namespaces storage by plugin id', async () => {
    const { host, api, storage } = makeHost();
    await api.storage.set('recent', [1, 2]);
    expect(storage.m.get('com.test.plugin:recent')).toEqual([1, 2]);
    await expect(api.storage.get('recent')).resolves.toEqual([1, 2]);
    host.dispose();
  });
});

describe('late bridges', () => {
  it('defers compiler registrations until a controller exists, and cancels them on dispose', async () => {
    const { host, api } = makeHost();
    const d = api.compiler.onDidCompile(() => {});
    expect(host.size()).toBe(1);
    d.dispose();
    expect(host.size()).toBe(0);
    await expect(api.compiler.compile()).resolves.toBeNull();
    host.dispose();
  });
});

describe('compile backends', () => {
  it('forwards prototype and optional methods of class-based backends', async () => {
    class MyBackend {
      id = 'plug';
      label = 'Plug';
      kind = 'plugin' as const;
      engines = ['pdflatex' as const];
      private secret = 41;
      async status() {
        return { available: true, detail: String(this.secret) };
      }
      async prepareFor() {
        this.secret++;
      }
      onStatusChange() {
        return { dispose() {} };
      }
      async compile(): Promise<never> {
        throw new Error('nope');
      }
    }
    let registered: any = null;
    setCompileController({ registerBackend: (b: unknown) => ((registered = b), { dispose: () => (registered = null) }) } as unknown as CompileController);
    const { host, api, onError } = makeHost();
    api.compiler.registerBackend(new MyBackend() as any);
    expect(registered).toBeTruthy();
    await registered.prepareFor({});
    await expect(registered.status()).resolves.toEqual({ available: true, detail: '42' });
    expect(typeof registered.onStatusChange).toBe('function');
    await expect(registered.compile({})).rejects.toThrow('nope');
    expect(onError).toHaveBeenCalledOnce();
    host.dispose();
    expect(registered).toBeNull();
    setCompileController(null);
  });
});

describe('loader', () => {
  it('checks API compatibility by major/minor', () => {
    expect(isApiCompatible(undefined)).toBe(true);
    expect(isApiCompatible('1.0.0', '1.1.0')).toBe(true);
    expect(isApiCompatible('^1.1', '1.1.0')).toBe(true);
    expect(isApiCompatible('1.2.0', '1.1.0')).toBe(false);
    expect(isApiCompatible('2.0.0', '1.1.0')).toBe(false);
  });

  it('extracts default, named or namespace exports and validates manifests', () => {
    const p = { id: 'a.b', name: 'A', version: '1', activate() {} };
    expect(extractPlugin({ default: p })).toBe(p);
    expect(extractPlugin({ plugin: p })).toBe(p);
    expect(() => extractPlugin({})).toThrow(/does not export/);
    expect(() => extractPlugin({ default: { ...p, id: 'bad id!' } })).toThrow(/reverse-DNS/);
    expect(() => extractPlugin({ default: { ...p, permissions: ['root'] } })).toThrow(/Unknown permission/);
  });
});

describe('plugin host localization (API 1.2)', () => {
  it('exposes the UI locale, notifies changes and stops after dispose', async () => {
    const { useSettings } = await import('@/state/settings');
    const prev = useSettings.getState().locale;
    useSettings.setState({ locale: 'en' });
    const { host, api } = makeHost();
    expect(api.ui.getLocale()).toBe('en');
    const seen: string[] = [];
    api.ui.onLocaleChange((l) => seen.push(l));
    useSettings.setState({ locale: 'es' });
    expect(api.ui.getLocale()).toBe('es');
    expect(seen).toEqual(['es']);
    host.dispose();
    useSettings.setState({ locale: 'en' });
    expect(seen).toEqual(['es']);
    useSettings.setState({ locale: prev });
  });

  it('registers translated command/panel titles from manifest locales', async () => {
    const { translate } = await import('@/lib/i18n');
    const { host } = makeHost({ locales: { es: { commands: { hello: 'Hola' }, panels: { panel: 'Panel ES' } } } });
    expect(translate('es', 'cmd.com.test.plugin.hello')).toBe('Hola');
    expect(translate('es', 'panel.com.test.plugin.panel')).toBe('Panel ES');
    host.dispose();
  });

  it('localizes manifests for display', async () => {
    const { localizeManifest } = await import('./localize');
    const m: PluginManifest = {
      id: 'x.y',
      name: 'Name',
      version: '1.0.0',
      settings: [{ key: 'k', title: 'Title', type: 'select', options: [{ value: 'a', label: 'A' }] }],
      locales: { es: { name: 'Nombre', settings: { k: { title: 'Título', options: { a: 'Á' } } } } },
    };
    const es = localizeManifest(m, 'es-MX');
    expect(es.name).toBe('Nombre');
    expect(es.settings?.[0].title).toBe('Título');
    expect(es.settings?.[0].options?.[0].label).toBe('Á');
    expect(localizeManifest(m, 'en')).toBe(m);
  });
});
