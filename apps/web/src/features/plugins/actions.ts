/** User-facing plugin actions shared by the panel, settings and commands. */
import { confirmDialog, promptDialog, toast } from '@/ui';
import { quickPick } from '@/ui/QuickPick';
import { useLayout } from '@/state/workspace';
import { getEntry, installFromFile, installFromRegistry, installFromUrl, reloadPlugin, uninstallPlugin, usePlugins } from './manager';
import type { RegistryEntry } from './registry';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function promptInstallFromUrl(initial = ''): Promise<void> {
  const url = await promptDialog({
    title: 'Install plugin from URL',
    message: 'URL of an ES module whose default export is a TexIt plugin (e.g. a raw GitHub file, a CDN like esm.sh, or http://localhost while developing).',
    placeholder: 'https://example.com/my-plugin.js',
    value: initial,
    confirmLabel: 'Install',
    validate: (v) => {
      try {
        const u = new URL(v.trim(), location.href);
        return /^(https?|blob):$/.test(u.protocol) ? null : 'Use an http(s) URL';
      } catch {
        return 'Not a valid URL';
      }
    },
  });
  if (url) await runInstall(() => installFromUrl(url.trim()));
}

export function pickPluginFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.mjs,text/javascript,application/javascript';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await runInstall(() => installFromFile(file));
      resolve();
    };
    input.click();
  });
}

export async function installRegistryEntry(entry: RegistryEntry) {
  await runInstall(() => installFromRegistry(entry));
}

async function runInstall(fn: () => Promise<{ manifest: { name: string; version: string }; status: string; error?: string } | null>) {
  try {
    const entry = await fn();
    if (!entry) return;
    if (entry.status === 'active') toast.success(`Installed ${entry.manifest.name} ${entry.manifest.version}`);
    else if (entry.status === 'error') toast.error(`${entry.manifest.name} was installed but failed to start`, { description: entry.error });
  } catch (err) {
    toast.error('Could not install the plugin', { description: errMsg(err) });
  }
}

export async function confirmUninstall(id: string) {
  const e = getEntry(id);
  if (!e) return;
  const ok = await confirmDialog({
    title: `Uninstall “${e.manifest.name}”?`,
    message: 'The plugin, its settings and its stored data will be removed.',
    confirmLabel: 'Uninstall',
    danger: true,
  });
  if (!ok) return;
  await uninstallPlugin(id);
  toast.success(`Uninstalled ${e.manifest.name}`);
}

export async function reloadWithToast(id: string) {
  const e = getEntry(id);
  if (!e) return;
  const ok = await reloadPlugin(id);
  const after = getEntry(id);
  if (ok && after?.status !== 'error') toast.success(`Reloaded ${e.manifest.name}`);
  else toast.error(`${e.manifest.name} failed to reload`, { description: after?.error });
}

export async function pickAndReload() {
  const { entries, order } = usePlugins.getState();
  const id = await quickPick(
    order.map((i) => entries[i]).filter((e) => e?.enabled).map((e) => ({ label: e.manifest.name, description: `${e.id} · v${e.manifest.version}`, value: e.id })),
    { placeholder: 'Reload which plugin?' },
  );
  if (id) await reloadWithToast(id);
}

export function showPluginsPanel() {
  const l = useLayout.getState();
  if (l.focusMode !== 'none') l.set({ focusMode: 'none' });
  l.showSidebarPanel('plugins');
}
