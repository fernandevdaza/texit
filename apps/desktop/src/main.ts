/**
 * TexIt desktop — Electron main process entry.
 */
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { Events, type MenuCommandId } from './shared/ipc';
import { registerIpc } from './main/ipc';
import { deepLinkQueue, openPathQueue } from './main/ipc/app';
import { stopAllWatches } from './main/ipc/fs';
import { shutdownMcp } from './main/ipc/mcp';
import { safeSend } from './main/ipc/util';
import { installAppMenu } from './main/menu';
import { DEEP_LINK_SCHEME, extractDeepLinks, extractOpenPaths } from './main/open-paths';
import { resolveStartUrl, runtime } from './main/paths';
import { registerAppProtocol, registerAppSchemePrivileges, resolveWebRoot } from './main/protocol';
import { installSecurityHandlers } from './main/security';
import { cancelAllAgentRuns } from './main/agents/run';
import { cancelAllCompiles } from './main/tex/compile';
import { checkForUpdatesInteractive, startPeriodicUpdateChecks } from './main/updater';
import { killAllChildren, killAllChildrenSync } from './main/util/process';
import { createMainWindow, preloadPath } from './main/window';

runtime.smoke = process.argv.includes('--smoke');
if (runtime.smoke) {
  // Isolated profile so the self-test never touches (or locks) the real user data.
  app.setPath('userData', path.join(os.tmpdir(), `texit-smoke-${process.pid}`));
}

registerAppSchemePrivileges();
app.enableSandbox();
app.setAppUserModelId('org.texit.app');

const gotLock = runtime.smoke || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

let mainWindow: BrowserWindow | null = null;
let startUrl = '';

function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

function createWindow(): BrowserWindow {
  const win = createMainWindow({ url: startUrl, preload: preloadPath() });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Dev: the Vite server may still be starting — retry until it answers.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || !runtime.devServerUrl || code === -3 /* ABORTED */) return;
    if (url.startsWith(runtime.devServerUrl)) setTimeout(() => !win.isDestroyed() && void win.loadURL(url), 1000);
  });
  return win;
}

function focusWindow(): BrowserWindow {
  const win = getMainWindow() ?? createWindow();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function sendMenuCommand(id: MenuCommandId) {
  const existing = BrowserWindow.getFocusedWindow() ?? getMainWindow();
  if (existing) {
    safeSend(existing.webContents, Events.menuCommand, id);
    return;
  }
  const win = createWindow();
  win.webContents.once('did-finish-load', () => setTimeout(() => safeSend(win.webContents, Events.menuCommand, id), 800));
}

function handleOpenPath(p: string) {
  openPathQueue.push(p);
  if (app.isReady() && !runtime.smoke) focusWindow();
}

function handleDeepLink(url: string) {
  if (!url.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) return;
  deepLinkQueue.push(url);
  if (app.isReady() && !runtime.smoke) focusWindow();
}

let quitting = false;
async function shutdown() {
  await Promise.allSettled([cancelAllCompiles(), cancelAllAgentRuns(), shutdownMcp(), stopAllWatches()]);
  await killAllChildren();
}

function bootstrap() {
  // macOS delivers files / URLs through events (possibly before `ready`).
  app.on('open-file', (event, p) => {
    event.preventDefault();
    handleOpenPath(p);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, argv, workingDirectory) => {
    for (const p of extractOpenPaths(argv, { cwd: workingDirectory, isPackaged: app.isPackaged })) handleOpenPath(p);
    for (const url of extractDeepLinks(argv)) handleDeepLink(url);
    focusWindow();
  });

  if (app.isPackaged && process.platform !== 'darwin' && !runtime.smoke) {
    // macOS registers the scheme through Info.plist (electron-builder `protocols`).
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || runtime.smoke) app.quit();
  });

  app.on('activate', () => {
    if (app.isReady() && !getMainWindow() && !runtime.smoke) createWindow();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    const timeout = new Promise((r) => setTimeout(r, 4000));
    void Promise.race([shutdown(), timeout]).finally(() => app.quit());
  });
  app.on('will-quit', () => killAllChildrenSync());

  void app.whenReady().then(async () => {
    installSecurityHandlers();
    runtime.webRoot = resolveWebRoot();
    registerAppProtocol(runtime.webRoot);
    registerIpc();
    installAppMenu({
      command: sendMenuCommand,
      checkForUpdates: () => void checkForUpdatesInteractive(),
    });

    if (runtime.smoke) {
      const { runSmoke } = await import('./main/smoke');
      const code = await runSmoke(preloadPath());
      await shutdown();
      app.exit(code);
      return;
    }

    startUrl = resolveStartUrl(runtime.webRoot);
    createWindow();

    // Windows / Linux: files and links passed on the command line of the first instance.
    for (const p of extractOpenPaths(process.argv, { cwd: process.cwd(), isPackaged: app.isPackaged })) handleOpenPath(p);
    for (const url of extractDeepLinks(process.argv)) handleDeepLink(url);

    startPeriodicUpdateChecks();
  });
}
