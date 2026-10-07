/**
 * Small React hooks around the desktop host (no-ops in the browser).
 */
import { useEffect, useRef, useState } from 'react';
import { getHost, type McpServerInfo, type ProjectDoc, type TexitHost } from '@texit/core';
import { FolderSync, type FolderSyncOptions, type FolderSyncStatus } from './folder-sync';
import { McpServerBridge, type McpToolDef } from './mcp-bridge';

export function useDesktopHost(): TexitHost | undefined {
  return getHost();
}

/** Subscribe to native menu commands. */
export function useMenuCommand(handler: (commandId: string) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => getHost()?.app.onMenuCommand((id) => ref.current(id)), []);
}

/** Subscribe to files/folders opened through the OS (double-click, dock, CLI). */
export function useOpenPath(handler: (absPath: string) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => getHost()?.app.onOpenPath((p) => ref.current(p)), []);
}

/** Keep a project mirrored to a folder while mounted. Returns the sync status and instance. */
export function useFolderSync(
  project: ProjectDoc | null | undefined,
  dir: string | null | undefined,
  opts: Omit<FolderSyncOptions, 'project' | 'dir'> = {},
): { status: FolderSyncStatus; sync: FolderSync | null; error: unknown } {
  const [state, setState] = useState<{ status: FolderSyncStatus; sync: FolderSync | null; error: unknown }>({ status: 'idle', sync: null, error: null });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const initial = opts.initial;
  useEffect(() => {
    if (!project || !dir || !getHost()) return;
    const sync = new FolderSync({
      ...optsRef.current,
      initial,
      project,
      dir,
      onError: (e) => {
        optsRef.current.onError?.(e);
        setState((s) => ({ ...s, error: e }));
      },
      onConflict: (c) => optsRef.current.onConflict?.(c),
      onDiskChange: (p) => optsRef.current.onDiskChange?.(p),
    });
    let alive = true;
    setState({ status: 'starting', sync, error: null });
    sync.start().then(
      () => alive && setState({ status: 'running', sync, error: null }),
      (error) => alive && setState({ status: 'stopped', sync: null, error }),
    );
    return () => {
      alive = false;
      void sync.stop();
    };
  }, [project, dir, initial]);
  return state;
}

/** Serve `tools` through TexIt's MCP server while mounted. */
export function useMcpServerBridge(tools: McpToolDef[] | null | undefined, opts: { autoStart?: boolean; port?: number } = {}): McpServerInfo | null {
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const bridgeRef = useRef<McpServerBridge | null>(null);
  const { autoStart, port } = opts;
  useEffect(() => {
    if (!getHost()) return;
    const bridge = new McpServerBridge([], { autoStart, port });
    bridgeRef.current = bridge;
    let alive = true;
    bridge.start().then((i) => alive && setInfo(i), () => alive && setInfo({ running: false }));
    return () => {
      alive = false;
      bridgeRef.current = null;
      void bridge.stop();
    };
  }, [autoStart, port]);
  useEffect(() => {
    void bridgeRef.current?.setTools(tools ?? []);
  }, [tools, info]);
  return info;
}
