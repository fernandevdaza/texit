/**
 * Sandboxed preload: exposes `window.texit` (the `TexitHost` contract from
 * @texit/core) through contextBridge. Only `electron`'s sandbox-safe modules are
 * used; every call goes through validated IPC handlers in the main process.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type {
  CliAgentEvent,
  CliAgentRunRequest,
  HostWatchEvent,
  JsonRpcMessage,
  McpServerToolCall,
  McpStdioConfig,
  NativeCompileRequest,
  TexitHost,
} from '@texit/core';
import { Events, Invoke, Send, Stream, SYNC_BOOTSTRAP, type BootstrapInfo } from './shared/ipc';

let counter = 0;
function uid(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}-${++counter}`;
}

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => {
    try {
      cb(...(args as T));
    } catch (err) {
      console.error(`[texit] listener for ${channel} threw`, err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function applyChromeCss(boot: BootstrapInfo) {
  const apply = () => {
    const el = document.documentElement;
    if (!el) return false;
    el.dataset.texitPlatform = boot.platform;
    el.dataset.texitChrome = boot.chrome.style;
    el.style.setProperty('--texit-titlebar-height', `${boot.chrome.height}px`);
    el.style.setProperty('--texit-titlebar-inset-left', `${boot.chrome.insetLeft}px`);
    el.style.setProperty('--texit-titlebar-inset-right', `${boot.chrome.insetRight}px`);
    return true;
  };
  if (!apply()) document.addEventListener('DOMContentLoaded', apply, { once: true });
}

function createHost(boot: BootstrapInfo): TexitHost {
  return {
    kind: 'electron',
    platform: boot.platform,
    appVersion: boot.appVersion,
    chrome: boot.chrome,

    tex: {
      detect: () => invoke(Invoke.texDetect),
      async compile(req: NativeCompileRequest, onLog?: (chunk: string) => void) {
        const off = onLog ? subscribe<[string]>(Stream.texLog(req.jobId), onLog) : () => undefined;
        try {
          return await invoke(Invoke.texCompile, req, !!onLog);
        } finally {
          off();
        }
      },
      cancel: (jobId: string) => invoke(Invoke.texCancel, jobId),
    },

    fs: {
      pickDirectory: (opts) => invoke(Invoke.fsPickDirectory, opts),
      pickFiles: (opts) => invoke(Invoke.fsPickFiles, opts),
      saveFile: (opts) => invoke(Invoke.fsSaveFile, opts),
      readTree: (dir) => invoke(Invoke.fsReadTree, dir),
      readFile: (absPath) => invoke(Invoke.fsReadFile, absPath),
      writeFile: (absPath, content) => invoke(Invoke.fsWriteFile, absPath, content),
      mkdir: (absPath) => invoke(Invoke.fsMkdir, absPath),
      remove: (absPath) => invoke(Invoke.fsRemove, absPath),
      rename: (from, to) => invoke(Invoke.fsRename, from, to),
      async watch(dir: string, cb: (events: HostWatchEvent[]) => void) {
        const watchId = uid('watch');
        const off = subscribe<[HostWatchEvent[]]>(Stream.fsWatch(watchId), cb);
        try {
          await invoke(Invoke.fsWatch, watchId, dir);
        } catch (err) {
          off();
          throw err;
        }
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          off();
          void invoke(Invoke.fsUnwatch, watchId).catch(() => undefined);
        };
      },
      projectMirrorDir: (projectId) => invoke(Invoke.fsProjectMirrorDir, projectId),
      revealInFolder: (absPath) => invoke(Invoke.fsRevealInFolder, absPath),
      openPath: (absPath) => invoke(Invoke.fsOpenPath, absPath),
    },

    agents: {
      detect: () => invoke(Invoke.agentsDetect),
      async run(req: CliAgentRunRequest, onEvent: (e: CliAgentEvent) => void) {
        const off = subscribe<[CliAgentEvent]>(Stream.agentEvent(req.runId), onEvent);
        try {
          return await invoke(Invoke.agentsRun, req);
        } finally {
          off();
        }
      },
      cancel: (runId: string) => invoke(Invoke.agentsCancel, runId),
    },

    mcp: {
      startStdio: (cfg: McpStdioConfig) => invoke(Invoke.mcpStartStdio, cfg),
      send: (id: string, msg: JsonRpcMessage) => invoke(Invoke.mcpSend, id, msg),
      onMessage: (id: string, cb: (msg: JsonRpcMessage) => void) => subscribe<[JsonRpcMessage]>(Stream.mcpMessage(id), cb),
      onExit: (id: string, cb: (info: { code: number | null; stderr: string }) => void) => subscribe(Stream.mcpExit(id), cb),
      stop: (id: string) => invoke(Invoke.mcpStop, id),
      serverInfo: () => invoke(Invoke.mcpServerInfo),
      startServer: (opts) => invoke(Invoke.mcpStartServer, opts),
      stopServer: () => invoke(Invoke.mcpStopServer),
      setServerTools: (tools) => invoke(Invoke.mcpSetServerTools, tools),
      onServerToolCall(cb: (call: McpServerToolCall) => void) {
        const off = subscribe<[McpServerToolCall]>(Events.mcpServerToolCall, cb);
        void invoke(Invoke.mcpAttachToolCalls).catch(() => undefined);
        return off;
      },
      respondToolCall: (callId, result) => invoke(Invoke.mcpRespondToolCall, callId, result),
      clientConfigSnippets: () => invoke(Invoke.mcpClientConfigSnippets),
    },

    secrets: {
      get: (key) => invoke(Invoke.secretsGet, key),
      set: (key, value) => invoke(Invoke.secretsSet, key, value),
      delete: (key) => invoke(Invoke.secretsDelete, key),
    },

    shell: {
      openExternal: (url) => invoke(Invoke.shellOpenExternal, url),
    },

    app: {
      onMenuCommand: (cb) => subscribe<[string]>(Events.menuCommand, cb),
      onOpenPath(cb) {
        const off = subscribe<[string]>(Events.openPath, cb);
        void invoke(Invoke.appOpenPathReady).catch(() => undefined);
        return off;
      },
      onDeepLink(cb) {
        const off = subscribe<[string]>(Events.deepLink, cb);
        void invoke(Invoke.appOpenPathReady).catch(() => undefined);
        return off;
      },
      setTitle: (title) => ipcRenderer.send(Send.appSetTitle, String(title ?? '')),
      setDocumentEdited: (edited) => ipcRenderer.send(Send.appSetDocumentEdited, !!edited),
      getPathForFile: (file) => webUtils.getPathForFile(file),
      checkForUpdates: () => invoke(Invoke.appCheckForUpdates),
      setTitleBarOverlay: (opts) => invoke(Invoke.appSetTitleBarOverlay, opts),
    },
  };
}

const boot = ipcRenderer.sendSync(SYNC_BOOTSTRAP) as BootstrapInfo | null;
if (boot) {
  applyChromeCss(boot);
  contextBridge.exposeInMainWorld('texit', createHost(boot));
}
