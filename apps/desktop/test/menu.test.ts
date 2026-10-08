import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildMenuTemplate, isMenuLocale, menuLabels, type MenuLocale, type MenuTemplateActions } from '../src/main/menu-template';
import { MENU_COMMANDS } from '../src/shared/ipc';

const actions = () => {
  const calls: string[] = [];
  const a = { calls, command: (id: string) => void calls.push(id), checkForUpdates: vi.fn(), reportIssue: vi.fn() };
  return a satisfies MenuTemplateActions;
};

const build = (platform: NodeJS.Platform, locale?: MenuLocale, a = actions()) => buildMenuTemplate(a, { platform, appName: 'TexIt', locale });

const submenu = (item: MenuItemConstructorOptions) => (Array.isArray(item.submenu) ? item.submenu : []);
const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((i) => [i, ...flatten(submenu(i))]);
const top = (tpl: MenuItemConstructorOptions[]) => tpl.map((i) => i.label);
const byLabel = (tpl: MenuItemConstructorOptions[], label: string) => flatten(tpl).find((i) => i.label === label);

describe('native menu template', () => {
  it('builds the English menu by default (macOS)', () => {
    const tpl = build('darwin');
    expect(top(tpl)).toEqual(['TexIt', 'File', 'Edit', 'View', 'Project', 'AI', 'Window', 'Help']);
    expect(byLabel(tpl, 'New Project…')?.accelerator).toBe('CmdOrCtrl+Shift+N');
    // English keeps Electron's native role labels.
    expect(flatten(tpl).find((i) => i.role === 'undo')?.label).toBeUndefined();
  });

  it('localizes top-level menus and custom items in Spanish', () => {
    const tpl = build('darwin', 'es');
    expect(top(tpl)).toEqual(['TexIt', 'Archivo', 'Editar', 'Ver', 'Proyecto', 'IA', 'Ventana', 'Ayuda']);
    for (const label of ['Nuevo proyecto…', 'Compilar', 'Detener la compilación', 'Buscar en el proyecto', 'Ajustes…', 'Buscar actualizaciones…']) {
      expect(byLabel(tpl, label), label).toBeDefined();
    }
    expect(byLabel(tpl, 'Compilar')?.accelerator).toBe('CmdOrCtrl+Enter');
    // Role items keep their role (behaviour + accelerator) with a translated label.
    expect(flatten(tpl).find((i) => i.role === 'undo')?.label).toBe('Deshacer');
    expect(flatten(tpl).find((i) => i.role === 'quit')?.label).toBe('Salir de TexIt');
    expect(tpl.find((i) => i.label === 'Ventana')?.role).toBe('windowMenu');
    expect(tpl.find((i) => i.label === 'Ayuda')?.role).toBe('help');
  });

  it('has the same structure and accelerators in every language', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const shape = (tpl: MenuItemConstructorOptions[]) => flatten(tpl).map((i) => [i.type ?? '', i.role ?? '', i.accelerator ?? ''].join('|'));
      expect(shape(build(platform, 'es'))).toEqual(shape(build(platform, 'en')));
    }
  });

  it('puts Settings, Quit and About in File/Help on Windows/Linux', () => {
    const tpl = build('win32', 'es');
    expect(top(tpl)).toEqual(['Archivo', 'Editar', 'Ver', 'Proyecto', 'IA', 'Ventana', 'Ayuda']);
    expect(submenu(tpl[0]).some((i) => i.role === 'quit' && i.label === 'Salir de TexIt')).toBe(true);
    expect(byLabel(tpl, 'Ajustes…')?.accelerator).toBe('Ctrl+,');
    expect(submenu(tpl[tpl.length - 1]).some((i) => i.role === 'about')).toBe(true);
  });

  it('dispatches command ids from both languages', () => {
    const a = actions();
    const tpl = build('linux', 'es', a);
    (byLabel(tpl, 'Compilar')?.click as () => void)();
    (byLabel(tpl, 'Nuevo archivo…')?.click as () => void)();
    (byLabel(tpl, 'Informar de un problema…')?.click as () => void)();
    expect(a.calls).toEqual(['project.compile', 'file.new']);
    expect(a.reportIssue).toHaveBeenCalledOnce();
    const ids = new Set<string>(MENU_COMMANDS);
    for (const item of flatten(tpl)) {
      if (!item.click || item.label === 'Informar de un problema…' || item.label === 'Buscar actualizaciones…') continue;
      a.calls.length = 0;
      (item.click as () => void)();
      expect(ids.has(a.calls[0]), String(item.label)).toBe(true);
    }
  });

  it('validates locales and falls back to English', () => {
    expect(isMenuLocale('es')).toBe(true);
    expect(isMenuLocale('fr')).toBe(false);
    expect(isMenuLocale(42)).toBe(false);
    expect(top(build('linux', 'fr' as MenuLocale))[0]).toBe('File');
    expect(Object.keys(menuLabels('es')).sort()).toEqual(Object.keys(menuLabels('en')).sort());
  });
});
