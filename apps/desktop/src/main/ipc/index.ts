import { app, ipcMain } from 'electron';
import { SYNC_BOOTSTRAP, type BootstrapInfo } from '../../shared/ipc';
import { windowChrome } from '../window';
import { registerAgentsIpc } from './agents';
import { registerAppIpc } from './app';
import { registerFsIpc } from './fs';
import { registerMcpIpc } from './mcp';
import { registerTexIpc } from './tex';
import { isTrustedSender } from './util';

export function registerIpc(): void {
  // Synchronous bootstrap for the preload (static, non-sensitive info only).
  ipcMain.on(SYNC_BOOTSTRAP, (event) => {
    if (!isTrustedSender(event)) {
      event.returnValue = null;
      return;
    }
    const info: BootstrapInfo = {
      platform: process.platform as BootstrapInfo['platform'],
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      chrome: windowChrome(),
    };
    event.returnValue = info;
  });
  registerTexIpc();
  registerFsIpc();
  registerAgentsIpc();
  registerMcpIpc();
  registerAppIpc();
}
