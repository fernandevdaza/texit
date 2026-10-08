/**
 * Native application menu. Items dispatch command ids from the web command
 * registry to the focused window (`host.app.onMenuCommand`).
 *
 * Keyboard handling: the renderer sees key events first; when the web app
 * handles a shortcut it calls preventDefault() and the menu accelerator does
 * not fire, so the two never run twice. Accelerators mirror the web bindings.
 *
 * The template itself lives in `menu-template.ts` (pure, unit-tested); the
 * renderer's UI language is applied with `setMenuLocale` (`host.app.setLocale`).
 */
import { app, Menu, shell } from 'electron';
import type { MenuCommandId } from '../shared/ipc';
import { buildMenuTemplate, isMenuLocale, type MenuLocale } from './menu-template';

export interface MenuActions {
  command(id: MenuCommandId): void;
  checkForUpdates(): void;
}

export const DOCS_URL = 'https://github.com/fernandevdaza/texit#readme';
export const ISSUES_URL = 'https://github.com/fernandevdaza/texit/issues';

export function buildMenu(actions: MenuActions, locale: MenuLocale = 'en'): Menu {
  return Menu.buildFromTemplate(
    buildMenuTemplate(
      { ...actions, reportIssue: () => void shell.openExternal(ISSUES_URL) },
      { platform: process.platform, appName: app.name, locale },
    ),
  );
}

let installed: { actions: MenuActions; locale: MenuLocale } | null = null;

/** Build and set the application menu (call once at startup). */
export function installAppMenu(actions: MenuActions, locale: MenuLocale = 'en'): void {
  installed = { actions, locale };
  Menu.setApplicationMenu(buildMenu(actions, locale));
}

/** Rebuild the application menu in another language. Returns true when it changed. */
export function setMenuLocale(locale: unknown): boolean {
  if (!installed || !isMenuLocale(locale) || installed.locale === locale) return false;
  installed = { ...installed, locale };
  Menu.setApplicationMenu(buildMenu(installed.actions, locale));
  return true;
}
