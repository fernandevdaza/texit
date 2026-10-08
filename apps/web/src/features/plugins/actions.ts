/** User-facing plugin actions shared by the panel, settings and commands. */
import type { PluginManifest } from '@texit/plugin-api';
import { confirmDialog, promptDialog, toast } from '@/ui';
import { quickPick } from '@/ui/QuickPick';
import { useLayout } from '@/state/workspace';
import { getEntry, installFromFile, installFromRegistry, installFromUrl, reloadPlugin, uninstallPlugin, usePlugins } from './manager';
import type { RegistryEntry } from './registry';
import { pluginName } from './localize';
import { t } from '@/lib/i18n';
import './i18n';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function promptInstallFromUrl(initial = ''): Promise<void> {
  const url = await promptDialog({
    title: t('plugins.installFromUrlTitle'),
    message: t('plugins.installFromUrlMessage'),
    placeholder: 'https://example.com/my-plugin.js',
    value: initial,
    confirmLabel: t('plugins.install'),
    validate: (v) => {
      try {
        const u = new URL(v.trim(), location.href);
        return /^(https?|blob):$/.test(u.protocol) ? null : t('plugins.useHttpUrl');
      } catch {
        return t('plugins.invalidUrl');
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

async function runInstall(fn: () => Promise<{ manifest: PluginManifest; status: string; error?: string } | null>) {
  try {
    const entry = await fn();
    if (!entry) return;
    const name = pluginName(entry.manifest);
    if (entry.status === 'active') toast.success(t('plugins.installedToast', { name, version: entry.manifest.version }));
    else if (entry.status === 'error') toast.error(t('plugins.installedButFailed', { name }), { description: entry.error });
  } catch (err) {
    toast.error(t('plugins.couldNotInstall'), { description: errMsg(err) });
  }
}

export async function confirmUninstall(id: string) {
  const e = getEntry(id);
  if (!e) return;
  const ok = await confirmDialog({
    title: t('plugins.uninstallConfirm', { name: pluginName(e.manifest) }),
    message: t('plugins.uninstallMessage'),
    confirmLabel: t('plugins.uninstall'),
    danger: true,
  });
  if (!ok) return;
  await uninstallPlugin(id);
  toast.success(t('plugins.uninstalled', { name: pluginName(e.manifest) }));
}

export async function reloadWithToast(id: string) {
  const e = getEntry(id);
  if (!e) return;
  const ok = await reloadPlugin(id);
  const after = getEntry(id);
  const name = pluginName(e.manifest);
  if (ok && after?.status !== 'error') toast.success(t('plugins.reloaded', { name }));
  else toast.error(t('plugins.failedToReload', { name }), { description: after?.error });
}

export async function pickAndReload() {
  const { entries, order } = usePlugins.getState();
  const id = await quickPick(
    order.map((i) => entries[i]).filter((e) => e?.enabled).map((e) => ({ label: pluginName(e.manifest), description: `${e.id} · v${e.manifest.version}`, value: e.id })),
    { placeholder: t('plugins.reloadWhich') },
  );
  if (id) await reloadWithToast(id);
}

export function showPluginsPanel() {
  const l = useLayout.getState();
  if (l.focusMode !== 'none') l.set({ focusMode: 'none' });
  l.showSidebarPanel('plugins');
}
