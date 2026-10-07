/**
 * Presence helpers built on the collaboration Awareness (if any): which peers
 * are viewing which file. Used by tabs and the file tree.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { awarenessChanged, getAwareness, type PeerUser } from '@/services/collab';
import { useWorkspace } from '@/state/workspace';
import { getProjectIndex } from './projectIndex';

export interface Peer {
  clientId: number;
  user: PeerUser;
}

let peers: Peer[] = [];
const listeners = new Set<() => void>();
let bound: Awareness | null = null;

function recompute() {
  const a = getAwareness();
  const next: Peer[] = [];
  if (a) {
    a.getStates().forEach((state, clientId) => {
      if (clientId === a.clientID) return;
      const user = (state as { user?: PeerUser }).user;
      if (user?.name) next.push({ clientId, user });
    });
  }
  const changed =
    next.length !== peers.length ||
    next.some((p, i) => p.clientId !== peers[i].clientId || p.user.fileId !== peers[i].user.fileId || p.user.color !== peers[i].user.color || p.user.name !== peers[i].user.name);
  if (changed) {
    peers = next;
    listeners.forEach((l) => l());
  }
}

const onChange = () => recompute();

function bind(a: Awareness | null) {
  if (bound === a) return;
  bound?.off('change', onChange);
  bound = a;
  a?.on('change', onChange);
  recompute();
}

let initialised = false;
function init() {
  if (initialised) return;
  initialised = true;
  awarenessChanged.on((a) => bind(a));
  bind(getAwareness());
}

function subscribe(cb: () => void) {
  init();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Remote peers (excluding the local client). */
export function usePeers(): Peer[] {
  return useSyncExternalStore(subscribe, () => peers);
}

/** Peers grouped by the file they're viewing. */
export function usePeersByFile(): Map<string, Peer[]> {
  const list = usePeers();
  const map = new Map<string, Peer[]>();
  for (const p of list) {
    if (!p.user.fileId) continue;
    const arr = map.get(p.user.fileId) ?? [];
    arr.push(p);
    map.set(p.user.fileId, arr);
  }
  return map;
}

/** Re-render whenever the project index changes (debounced content / tree changes). */
export function useIndexVersion(): number {
  const [v, setV] = useState(0);
  const project = useWorkspace((s) => s.project);
  const treeVersion = useWorkspace((s) => s.treeVersion);
  useEffect(() => {
    const idx = getProjectIndex();
    if (!idx) return;
    const d = idx.changed.on(() => setV((x) => x + 1));
    return () => d.dispose();
  }, [project]);
  return v * 100000 + treeVersion;
}
