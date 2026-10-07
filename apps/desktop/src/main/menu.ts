/**
 * Native application menu. Items dispatch command ids from the web command
 * registry to the focused window (`host.app.onMenuCommand`).
 *
 * Keyboard handling: the renderer sees key events first; when the web app
 * handles a shortcut it calls preventDefault() and the menu accelerator does
 * not fire, so the two never run twice. Accelerators mirror the web bindings.
 */
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommandId } from '../shared/ipc';

export interface MenuActions {
  command(id: MenuCommandId): void;
  checkForUpdates(): void;
}

export const DOCS_URL = 'https://github.com/texit-app/texit#readme';
export const ISSUES_URL = 'https://github.com/texit-app/texit/issues';

export function buildMenu(actions: MenuActions): Menu {
  const isMac = process.platform === 'darwin';
  const cmd = (label: string, id: MenuCommandId, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => actions.command(id),
  });

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => actions.checkForUpdates() },
        { type: 'separator' },
        cmd('Settings…', 'app.settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      cmd('New Project…', 'project.new', 'CmdOrCtrl+Shift+N'),
      cmd('New File…', 'file.new', 'CmdOrCtrl+N'),
      { type: 'separator' },
      cmd('Open Project…', 'project.open', 'CmdOrCtrl+O'),
      cmd('Open Folder as Project…', 'project.openFolder'),
      { type: 'separator' },
      cmd('Import ZIP…', 'project.importZip'),
      cmd('Export as ZIP…', 'project.exportZip'),
      { type: 'separator' },
      cmd('Save', 'file.save', 'CmdOrCtrl+S'),
      cmd('Close File', 'file.close', 'CmdOrCtrl+W'),
      ...(isMac
        ? []
        : ([{ type: 'separator' }, cmd('Settings…', 'app.settings', 'Ctrl+,'), { type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      cmd('Find', 'edit.find', 'CmdOrCtrl+F'),
      cmd('Find in Project', 'edit.findInProject', 'CmdOrCtrl+Shift+F'),
      ...(isMac
        ? ([{ type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }] as MenuItemConstructorOptions[])
        : []),
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      cmd('Command Palette…', 'view.commandPalette', 'CmdOrCtrl+Shift+P'),
      { type: 'separator' },
      cmd('Toggle Sidebar', 'view.toggleSidebar', 'CmdOrCtrl+Shift+B'),
      cmd('Toggle PDF Preview', 'view.togglePdf', 'CmdOrCtrl+Alt+P'),
      cmd('Toggle AI Assistant', 'view.toggleAi', 'CmdOrCtrl+L'),
      { type: 'separator' },
      cmd('Zoom In', 'view.zoomIn', 'CmdOrCtrl+='),
      { ...cmd('Zoom In', 'view.zoomIn', 'CmdOrCtrl+Plus'), visible: false, acceleratorWorksWhenHidden: true },
      cmd('Zoom Out', 'view.zoomOut', 'CmdOrCtrl+-'),
      cmd('Actual Size', 'view.resetZoom', 'CmdOrCtrl+0'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      {
        label: 'Developer',
        submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
      },
    ],
  });

  template.push({
    label: 'Project',
    submenu: [cmd('Compile', 'project.compile', 'CmdOrCtrl+Enter'), cmd('Stop Compilation', 'project.stopCompile', 'CmdOrCtrl+.')],
  });

  template.push({
    label: 'AI',
    submenu: [cmd('Open Chat', 'ai.openChat', 'CmdOrCtrl+Shift+L'), cmd('Inline Edit…', 'ai.inlineEdit', 'CmdOrCtrl+K')],
  });

  template.push({
    label: 'Window',
    role: 'windowMenu',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  });

  template.push({
    label: 'Help',
    role: 'help',
    submenu: [
      cmd('Documentation', 'help.docs'),
      cmd('Keyboard Shortcuts', 'help.shortcuts'),
      { type: 'separator' },
      { label: 'Report an Issue…', click: () => void shell.openExternal(ISSUES_URL) },
      ...(isMac ? [] : ([{ type: 'separator' }, { label: 'Check for Updates…', click: () => actions.checkForUpdates() }, { role: 'about' }] as MenuItemConstructorOptions[])),
    ],
  });

  return Menu.buildFromTemplate(template);
}
