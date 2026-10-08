import { BrowserWindow, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { Events, Invoke, Send } from '../../shared/ipc';
import { SecretStore } from '../secrets';
import { isSafeExternalUrl } from '../protocol-utils';
import { paths } from '../paths';
import { PendingQueue } from '../open-paths';
import { checkForUpdates } from '../updater';
import { setTitleBarOverlay } from '../window';
import { setMenuLocale } from '../menu';
import { MENU_LOCALES } from '../menu-template';
import { handle, on, safeSend } from './util';

/** OS-provided paths / deep links waiting for a renderer to subscribe. */
export const openPathQueue = new PendingQueue<string>();
export const deepLinkQueue = new PendingQueue<string>();

let openPathTarget: WebContents | null = null;

function attachOpenPathTarget(wc: WebContents) {
  openPathTarget = wc;
  openPathQueue.attach((p) => safeSend(openPathTarget, Events.openPath, p));
  deepLinkQueue.attach((u) => safeSend(openPathTarget, Events.deepLink, u));
  wc.once('destroyed', () => {
    if (openPathTarget !== wc) return;
    openPathTarget = null;
    openPathQueue.detach();
    deepLinkQueue.detach();
  });
}

const zSecretKey = z.string().min(1).max(200).regex(/^[\w.:@/-]+$/, 'invalid secret key');
const zColor = z.string().max(64).regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/, 'invalid color');

export function registerAppIpc(): void {
  const secrets = new SecretStore(paths.secrets());

  handle(Invoke.secretsGet, z.tuple([zSecretKey]), (_e, key) => secrets.get(key));
  handle(Invoke.secretsSet, z.tuple([zSecretKey, z.string().max(64 * 1024)]), (_e, key, value) => secrets.set(key, value));
  handle(Invoke.secretsDelete, z.tuple([zSecretKey]), (_e, key) => secrets.delete(key));

  handle(Invoke.shellOpenExternal, z.tuple([z.string().max(8192)]), async (_e, url) => {
    if (!isSafeExternalUrl(url)) throw new Error('Only http(s) and mailto links can be opened');
    await shell.openExternal(url);
  });

  handle(Invoke.appCheckForUpdates, z.tuple([]), () => checkForUpdates());
  handle(Invoke.appOpenPathReady, z.tuple([]), (event) => attachOpenPathTarget(event.sender));
  handle(
    Invoke.appSetTitleBarOverlay,
    z.tuple([z.object({ color: zColor.optional(), symbolColor: zColor.optional(), height: z.number().int().min(20).max(80).optional() })]),
    (event, opts) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) setTitleBarOverlay(win, opts);
    },
  );

  on(Send.appSetTitle, z.tuple([z.string().max(1024)]), (event, title) => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(title || 'TexIt');
  });
  // UI language of the renderer → localized native menu.
  on(Send.appSetLocale, z.tuple([z.enum(MENU_LOCALES as ['en', 'es'])]), (_event, locale) => {
    setMenuLocale(locale);
  });
  on(Send.appSetDocumentEdited, z.tuple([z.boolean()]), (event, edited) => {
    if (process.platform === 'darwin') BrowserWindow.fromWebContents(event.sender)?.setDocumentEdited(edited);
  });
}
