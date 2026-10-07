/**
 * Plugins feature: exposes `window.TexIt`, registers the management commands
 * and activates enabled plugins once the app's own features are registered.
 */
import { definePlugin, PLUGIN_API_VERSION } from '@texit/plugin-api';
import { registerCommands } from '@/services/commands';
import * as manager from './manager';
import { initPlugins, primeSourceHashes, reloadChangedPlugins } from './manager';
import { usePluginPrefs, useRegistry } from './registry';
import { pickAndReload, pickPluginFile, promptInstallFromUrl, showPluginsPanel } from './actions';

declare global {
  interface Window {
    /** Global for plain-JS plugins loaded from a URL (no bundler needed). */
    TexIt?: { definePlugin: typeof definePlugin; apiVersion: string };
  }
}

export function activate(): () => void {
  window.TexIt = Object.freeze({ definePlugin, apiVersion: PLUGIN_API_VERSION });

  const commands = registerCommands([
    { id: 'plugins.installFromUrl', title: 'Install plugin from URL…', category: 'Plugins', run: () => promptInstallFromUrl() },
    { id: 'plugins.installFromFile', title: 'Install plugin from file…', category: 'Plugins', run: () => pickPluginFile() },
    { id: 'plugins.browse', title: 'Browse plugins', category: 'Plugins', run: () => showPluginsPanel() },
    { id: 'plugins.reload', title: 'Reload a plugin…', category: 'Plugins', run: () => pickAndReload() },
  ]);

  // After every built-in feature has registered (we are activated last) and the first paint.
  const start = setTimeout(() => void initPlugins(), 0);

  // Developer mode: reload URL plugins whose source changed when the window regains focus.
  let lastCheck = 0;
  const onFocus = () => {
    if (!usePluginPrefs.getState().devMode || Date.now() - lastCheck < 1000) return;
    lastCheck = Date.now();
    void reloadChangedPlugins();
  };
  window.addEventListener('focus', onFocus);
  const unsubPrefs = usePluginPrefs.subscribe((s, p) => {
    if (s.devMode && !p.devMode) void primeSourceHashes();
    if (s.registryUrl !== p.registryUrl) void useRegistry.getState().load(true);
  });

  if (import.meta.env.DEV) {
    const debug = { ...manager };
    (window as any).__texitPlugins = debug;
    const attach = () => {
      const t = (window as any).__texit;
      if (t) t.plugins = debug;
      else setTimeout(attach, 250);
    };
    attach();
  }

  return () => {
    clearTimeout(start);
    commands.dispose();
    window.removeEventListener('focus', onFocus);
    unsubPrefs();
  };
}
