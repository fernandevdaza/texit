/**
 * IPC channel names shared by the main process and the preload script.
 *
 * Request/response calls use `ipcRenderer.invoke` on the `Invoke` channels.
 * Streams (compile logs, agent events, MCP messages, fs watch batches, menu
 * commands…) use main → renderer `webContents.send` on per-id channels built
 * with the helpers below, so every subscription can be cleaned up precisely.
 *
 * This module must stay dependency-free: it is bundled into the sandboxed
 * preload script.
 */
import type { HostWindowChrome } from '@texit/core';

export const Invoke = {
  // tex
  texDetect: 'texit:tex:detect',
  texCompile: 'texit:tex:compile',
  texCancel: 'texit:tex:cancel',
  // fs
  fsPickDirectory: 'texit:fs:pickDirectory',
  fsPickFiles: 'texit:fs:pickFiles',
  fsSaveFile: 'texit:fs:saveFile',
  fsReadTree: 'texit:fs:readTree',
  fsReadFile: 'texit:fs:readFile',
  fsWriteFile: 'texit:fs:writeFile',
  fsMkdir: 'texit:fs:mkdir',
  fsRemove: 'texit:fs:remove',
  fsRename: 'texit:fs:rename',
  fsWatch: 'texit:fs:watch',
  fsUnwatch: 'texit:fs:unwatch',
  fsProjectMirrorDir: 'texit:fs:projectMirrorDir',
  fsRevealInFolder: 'texit:fs:revealInFolder',
  fsOpenPath: 'texit:fs:openPath',
  // agents
  agentsDetect: 'texit:agents:detect',
  agentsRun: 'texit:agents:run',
  agentsCancel: 'texit:agents:cancel',
  // mcp
  mcpStartStdio: 'texit:mcp:startStdio',
  mcpSend: 'texit:mcp:send',
  mcpStop: 'texit:mcp:stop',
  mcpServerInfo: 'texit:mcp:serverInfo',
  mcpStartServer: 'texit:mcp:startServer',
  mcpStopServer: 'texit:mcp:stopServer',
  mcpSetServerTools: 'texit:mcp:setServerTools',
  mcpRespondToolCall: 'texit:mcp:respondToolCall',
  mcpClientConfigSnippets: 'texit:mcp:clientConfigSnippets',
  mcpAttachToolCalls: 'texit:mcp:attachToolCalls',
  // secrets
  secretsGet: 'texit:secrets:get',
  secretsSet: 'texit:secrets:set',
  secretsDelete: 'texit:secrets:delete',
  // shell
  shellOpenExternal: 'texit:shell:openExternal',
  // app
  appCheckForUpdates: 'texit:app:checkForUpdates',
  appOpenPathReady: 'texit:app:openPathReady',
  appSetTitleBarOverlay: 'texit:app:setTitleBarOverlay',
} as const;

/** Fire-and-forget renderer → main messages (`ipcRenderer.send`). */
export const Send = {
  appSetTitle: 'texit:app:setTitle',
  appSetDocumentEdited: 'texit:app:setDocumentEdited',
  appSetLocale: 'texit:app:setLocale',
} as const;

/** Main → renderer broadcast channels. */
export const Events = {
  menuCommand: 'texit:app:menuCommand',
  openPath: 'texit:app:openPath',
  deepLink: 'texit:app:deepLink',
  mcpServerToolCall: 'texit:mcp:serverToolCall',
} as const;

/** Per-id stream channels (main → renderer). */
export const Stream = {
  texLog: (jobId: string) => `texit:tex:log:${jobId}`,
  agentEvent: (runId: string) => `texit:agents:event:${runId}`,
  mcpMessage: (id: string) => `texit:mcp:message:${id}`,
  mcpExit: (id: string) => `texit:mcp:exit:${id}`,
  fsWatch: (watchId: string) => `texit:fs:watch:${watchId}`,
} as const;

/** Synchronous bootstrap info, fetched once by the preload (`ipcRenderer.sendSync`). */
export const SYNC_BOOTSTRAP = 'texit:bootstrap';

export interface BootstrapInfo {
  platform: 'darwin' | 'win32' | 'linux';
  appVersion: string;
  isPackaged: boolean;
  chrome: WindowChromeInfo;
}

/** How the native window frame is drawn (see `HostWindowChrome` in @texit/core). */
export type WindowChromeInfo = HostWindowChrome;

/** Menu command ids sent to the renderer (mirrors the web command registry). */
export const MENU_COMMANDS = [
  'project.new',
  'project.open',
  'project.openFolder',
  'project.importZip',
  'project.exportZip',
  'project.compile',
  'project.stopCompile',
  'file.new',
  'file.save',
  'file.close',
  'view.commandPalette',
  'view.toggleSidebar',
  'view.togglePdf',
  'view.toggleAi',
  'view.zoomIn',
  'view.zoomOut',
  'view.resetZoom',
  'edit.find',
  'edit.findInProject',
  'ai.openChat',
  'ai.inlineEdit',
  'app.settings',
  'help.docs',
  'help.shortcuts',
] as const;

export type MenuCommandId = (typeof MENU_COMMANDS)[number];
