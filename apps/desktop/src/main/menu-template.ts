/**
 * Pure builder for the native application menu template (no Electron runtime
 * imports, so it can be unit-tested). `menu.ts` turns it into a `Menu`.
 *
 * Labels are localized for the renderer's UI language (`host.app.setLocale`).
 * English keeps Electron's native labels for role items; other languages give
 * role items a translated `label` (the role still provides the behaviour and
 * the accelerator), because Electron's built-in role labels are English-only.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommandId } from '../shared/ipc';

export type MenuLocale = 'en' | 'es';
export const MENU_LOCALES: readonly MenuLocale[] = ['en', 'es'];

export function isMenuLocale(v: unknown): v is MenuLocale {
  return typeof v === 'string' && (MENU_LOCALES as readonly string[]).includes(v);
}

export interface MenuTemplateActions {
  command(id: MenuCommandId): void;
  checkForUpdates(): void;
  reportIssue(): void;
}

export interface MenuTemplateOptions {
  platform: NodeJS.Platform;
  appName: string;
  locale?: MenuLocale;
}

type Labels = typeof EN;

const EN = {
  file: 'File',
  edit: 'Edit',
  view: 'View',
  project: 'Project',
  ai: 'AI',
  window: 'Window',
  help: 'Help',
  checkForUpdates: 'Check for Updates…',
  settings: 'Settings…',
  newProject: 'New Project…',
  newFile: 'New File…',
  openProject: 'Open Project…',
  openFolder: 'Open Folder as Project…',
  importZip: 'Import ZIP…',
  exportZip: 'Export as ZIP…',
  save: 'Save',
  closeFile: 'Close File',
  find: 'Find',
  findInProject: 'Find in Project',
  speech: 'Speech',
  commandPalette: 'Command Palette…',
  toggleSidebar: 'Toggle Sidebar',
  togglePdf: 'Toggle PDF Preview',
  toggleAi: 'Toggle AI Assistant',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  actualSize: 'Actual Size',
  developer: 'Developer',
  compile: 'Compile',
  stopCompile: 'Stop Compilation',
  openChat: 'Open Chat',
  inlineEdit: 'Inline Edit…',
  documentation: 'Documentation',
  shortcuts: 'Keyboard Shortcuts',
  reportIssue: 'Report an Issue…',
};

const ES: Labels = {
  file: 'Archivo',
  edit: 'Editar',
  view: 'Ver',
  project: 'Proyecto',
  ai: 'IA',
  window: 'Ventana',
  help: 'Ayuda',
  checkForUpdates: 'Buscar actualizaciones…',
  settings: 'Ajustes…',
  newProject: 'Nuevo proyecto…',
  newFile: 'Nuevo archivo…',
  openProject: 'Abrir proyecto…',
  openFolder: 'Abrir carpeta como proyecto…',
  importZip: 'Importar ZIP…',
  exportZip: 'Exportar como ZIP…',
  save: 'Guardar',
  closeFile: 'Cerrar archivo',
  find: 'Buscar',
  findInProject: 'Buscar en el proyecto',
  speech: 'Voz',
  commandPalette: 'Paleta de comandos…',
  toggleSidebar: 'Mostrar/ocultar barra lateral',
  togglePdf: 'Mostrar/ocultar vista previa del PDF',
  toggleAi: 'Mostrar/ocultar asistente de IA',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  actualSize: 'Tamaño real',
  developer: 'Desarrollador',
  compile: 'Compilar',
  stopCompile: 'Detener la compilación',
  openChat: 'Abrir chat',
  inlineEdit: 'Edición en línea…',
  documentation: 'Documentación',
  shortcuts: 'Atajos de teclado',
  reportIssue: 'Informar de un problema…',
};

type Role = NonNullable<MenuItemConstructorOptions['role']>;

/** Spanish labels for role items (`{app}` → app name). */
const ES_ROLES: Partial<Record<Role, string>> = {
  about: 'Acerca de {app}',
  services: 'Servicios',
  hide: 'Ocultar {app}',
  hideOthers: 'Ocultar otros',
  unhide: 'Mostrar todo',
  quit: 'Salir de {app}',
  undo: 'Deshacer',
  redo: 'Rehacer',
  cut: 'Cortar',
  copy: 'Copiar',
  paste: 'Pegar',
  pasteAndMatchStyle: 'Pegar con el mismo estilo',
  delete: 'Eliminar',
  selectAll: 'Seleccionar todo',
  startSpeaking: 'Empezar a hablar',
  stopSpeaking: 'Dejar de hablar',
  togglefullscreen: 'Pantalla completa',
  reload: 'Recargar',
  forceReload: 'Forzar recarga',
  toggleDevTools: 'Herramientas de desarrollo',
  minimize: 'Minimizar',
  zoom: 'Zoom',
  close: 'Cerrar ventana',
  front: 'Traer todo al frente',
};

const LABELS: Record<MenuLocale, Labels> = { en: EN, es: ES };

export function menuLabels(locale: MenuLocale = 'en'): Labels {
  return LABELS[locale] ?? EN;
}

export function buildMenuTemplate(actions: MenuTemplateActions, opts: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const isMac = opts.platform === 'darwin';
  const locale: MenuLocale = isMenuLocale(opts.locale) ? opts.locale : 'en';
  const L = menuLabels(locale);
  const role = (r: Role): MenuItemConstructorOptions => {
    const label = locale === 'es' ? ES_ROLES[r] : undefined;
    return label ? { role: r, label: label.replace('{app}', opts.appName) } : { role: r };
  };
  const cmd = (label: string, id: MenuCommandId, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => actions.command(id),
  });
  const sep: MenuItemConstructorOptions = { type: 'separator' };

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: opts.appName,
      submenu: [
        role('about'),
        { label: L.checkForUpdates, click: () => actions.checkForUpdates() },
        sep,
        cmd(L.settings, 'app.settings', 'Cmd+,'),
        sep,
        role('services'),
        sep,
        role('hide'),
        role('hideOthers'),
        role('unhide'),
        sep,
        role('quit'),
      ],
    });
  }

  template.push({
    label: L.file,
    submenu: [
      cmd(L.newProject, 'project.new', 'CmdOrCtrl+Shift+N'),
      cmd(L.newFile, 'file.new', 'CmdOrCtrl+N'),
      sep,
      cmd(L.openProject, 'project.open', 'CmdOrCtrl+O'),
      cmd(L.openFolder, 'project.openFolder'),
      sep,
      cmd(L.importZip, 'project.importZip'),
      cmd(L.exportZip, 'project.exportZip'),
      sep,
      cmd(L.save, 'file.save', 'CmdOrCtrl+S'),
      cmd(L.closeFile, 'file.close', 'CmdOrCtrl+W'),
      ...(isMac ? [] : [sep, cmd(L.settings, 'app.settings', 'Ctrl+,'), sep, role('quit')]),
    ],
  });

  template.push({
    label: L.edit,
    submenu: [
      role('undo'),
      role('redo'),
      sep,
      role('cut'),
      role('copy'),
      role('paste'),
      role('pasteAndMatchStyle'),
      role('delete'),
      role('selectAll'),
      sep,
      cmd(L.find, 'edit.find', 'CmdOrCtrl+F'),
      cmd(L.findInProject, 'edit.findInProject', 'CmdOrCtrl+Shift+F'),
      ...(isMac ? [sep, { label: L.speech, submenu: [role('startSpeaking'), role('stopSpeaking')] }] : []),
    ],
  });

  template.push({
    label: L.view,
    submenu: [
      cmd(L.commandPalette, 'view.commandPalette', 'CmdOrCtrl+Shift+P'),
      sep,
      cmd(L.toggleSidebar, 'view.toggleSidebar', 'CmdOrCtrl+Shift+B'),
      cmd(L.togglePdf, 'view.togglePdf', 'CmdOrCtrl+Alt+P'),
      cmd(L.toggleAi, 'view.toggleAi', 'CmdOrCtrl+L'),
      sep,
      cmd(L.zoomIn, 'view.zoomIn', 'CmdOrCtrl+='),
      { ...cmd(L.zoomIn, 'view.zoomIn', 'CmdOrCtrl+Plus'), visible: false, acceleratorWorksWhenHidden: true },
      cmd(L.zoomOut, 'view.zoomOut', 'CmdOrCtrl+-'),
      cmd(L.actualSize, 'view.resetZoom', 'CmdOrCtrl+0'),
      sep,
      role('togglefullscreen'),
      sep,
      { label: L.developer, submenu: [role('reload'), role('forceReload'), role('toggleDevTools')] },
    ],
  });

  template.push({
    label: L.project,
    submenu: [cmd(L.compile, 'project.compile', 'CmdOrCtrl+Enter'), cmd(L.stopCompile, 'project.stopCompile', 'CmdOrCtrl+.')],
  });

  template.push({
    label: L.ai,
    submenu: [cmd(L.openChat, 'ai.openChat', 'CmdOrCtrl+Shift+L'), cmd(L.inlineEdit, 'ai.inlineEdit', 'CmdOrCtrl+K')],
  });

  template.push({
    label: L.window,
    role: 'windowMenu',
    submenu: isMac
      ? [role('minimize'), role('zoom'), sep, role('front'), sep, { role: 'window' }]
      : [role('minimize'), role('zoom'), role('close')],
  });

  template.push({
    label: L.help,
    role: 'help',
    submenu: [
      cmd(L.documentation, 'help.docs'),
      cmd(L.shortcuts, 'help.shortcuts'),
      sep,
      { label: L.reportIssue, click: () => actions.reportIssue() },
      ...(isMac ? [] : [sep, { label: L.checkForUpdates, click: () => actions.checkForUpdates() }, role('about')]),
    ],
  });

  return template;
}
