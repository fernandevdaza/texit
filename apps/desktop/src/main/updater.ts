/**
 * Auto-updates through electron-updater (GitHub releases, see electron-builder.yml `publish`).
 * No-op in development / unpackaged runs.
 */
import { app, dialog } from 'electron';

type Updater = typeof import('electron-updater').autoUpdater;

let updater: Updater | null = null;
let periodic: NodeJS.Timeout | null = null;

async function getUpdater(): Promise<Updater | null> {
  if (!app.isPackaged || process.env.TEXIT_DISABLE_UPDATES) return null;
  if (updater) return updater;
  const mod = await import('electron-updater');
  updater = mod.autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = /-(alpha|beta|rc)/.test(app.getVersion());
  updater.logger = null;
  updater.on('error', () => undefined);
  return updater;
}

export async function checkForUpdates(): Promise<{ available: boolean; version?: string }> {
  const u = await getUpdater();
  if (!u) return { available: false };
  try {
    const result = await u.checkForUpdates();
    const version = result?.updateInfo?.version;
    const available = !!result?.isUpdateAvailable || (!!version && version !== app.getVersion() && compareVersions(version, app.getVersion()) > 0);
    return { available, version: available ? version : undefined };
  } catch {
    return { available: false };
  }
}

/** Interactive check from the menu: reports the result in a dialog. */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ type: 'info', message: 'Updates are disabled in development builds.' });
    return;
  }
  const r = await checkForUpdates();
  await dialog.showMessageBox({
    type: 'info',
    message: r.available ? `TexIt ${r.version} is available` : 'TexIt is up to date',
    detail: r.available ? 'It is being downloaded and will be installed when you quit TexIt.' : `You are running version ${app.getVersion()}.`,
  });
}

export function startPeriodicUpdateChecks(): void {
  if (!app.isPackaged || periodic) return;
  setTimeout(() => void checkForUpdates(), 15_000);
  periodic = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
