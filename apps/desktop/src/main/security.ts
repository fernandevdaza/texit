/**
 * Secure defaults for every web contents: no navigation away from the app,
 * external links open in the OS browser, no <webview>, minimal permissions.
 */
import { app, session, shell, type WebContents } from 'electron';
import { isAppUrl, isSafeExternalUrl } from './protocol-utils';
import { runtime } from './paths';

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications', 'pointerLock']);

function openExternalSafely(url: string) {
  if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
}

function harden(contents: WebContents) {
  contents.setWindowOpenHandler(({ url, frameName }) => {
    // The detached live PDF preview: a same-origin about:blank popup the renderer fills itself.
    if (frameName === 'texit-pdf-preview' && (url === '' || url === 'about:blank')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 1120,
          title: 'PDF preview — TexIt',
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    openExternalSafely(url);
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string) => {
    if (isAppUrl(url, runtime.devServerUrl)) return;
    event.preventDefault();
    openExternalSafely(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) guard(event, url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function installSecurityHandlers(): void {
  app.on('web-contents-created', (_event, contents) => harden(contents));

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const origin = details.requestingUrl ?? '';
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin, runtime.devServerUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin, runtime.devServerUrl);
  });
  // Never let pages pick arbitrary devices.
  ses.setDevicePermissionHandler(() => false);
}
