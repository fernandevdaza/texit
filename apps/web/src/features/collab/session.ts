/**
 * Collaboration session manager.
 *
 * Watches the workspace session; when the open project has a room record it
 * creates the Awareness, publishes it through `services/collab` (editor
 * cursors, presence, follow mode) and connects a TrysteroProvider. Closing the
 * project disconnects gracefully and clears the awareness.
 *
 * Public API (also used by the UI):
 *   useCollab                      reactive state (status, peers, record…)
 *   startSharing() / stopSharing({ rotate }) / leaveSession()
 *   setPaused(paused)              go offline / back online without forgetting the room
 *   inviteLink(viewOnly)           invite URL for the current room
 *   getProvider()                  the live provider (or null)
 */
import { create } from 'zustand';
import { Awareness } from 'y-protocols/awareness';
import type { ProjectSession } from '@/services/projects';
import { updateSummary } from '@/services/projects';
import { setAwareness, type PeerUser } from '@/services/collab';
import { useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { TrysteroProvider, type ProviderStatus } from './provider';
import { fromBase64Url, generateRoomId, generateSecret, toBase64Url } from './crypto';
import { trysteroTransport, type SignalingState, type SignalingStrategy } from './transport';
import { lightColor, transportOptionsFor, useCollabSettings } from './settings';
import { buildInviteLink, deleteRoomRecord, getRoomRecord, saveRoomRecord, type RoomRecord } from './rooms';

export type CollabUiStatus = 'off' | 'paused' | 'offline' | 'connecting' | 'waiting' | 'live';

/** Extra awareness field published next to `user`. */
export interface PeerMeta {
  uid: string;
  role: 'owner' | 'guest';
  viewOnly: boolean;
}

export interface CollabPeerView {
  clientId: number;
  peerId?: string;
  name: string;
  color: string;
  fileId?: string;
  role?: 'owner' | 'guest';
  viewOnly?: boolean;
  rtt?: number;
  /** Directly connected over WebRTC (vs. relayed through another peer). */
  direct: boolean;
  /** Has a cursor in a text file. */
  hasCursor: boolean;
}

export interface CommentDraft {
  fileId: string;
  from: number;
  to: number;
  quote: string;
  line: number;
}

export interface CollabState {
  projectId: string | null;
  record: RoomRecord | null;
  status: CollabUiStatus;
  providerStatus: ProviderStatus;
  signaling: SignalingState;
  /** Remote collaborators known through awareness. */
  peers: CollabPeerView[];
  /** Directly connected transport peers. */
  connectedPeers: number;
  synced: boolean;
  fingerprint: string | null;
  error: string | null;
  incoming: { received: number; total: number } | null;
  /** Awareness client id of the peer being followed. */
  following: number | null;
  shareOpen: boolean;
  /** Comment highlighted in the editor / comments panel. */
  activeCommentId: string | null;
  commentDraft: CommentDraft | null;
  /** Unread chat messages (from others) in the open project. */
  unreadChat: number;
  /** Unresolved comment threads in the open project. */
  openComments: number;
}

const emptySignaling: SignalingState = { connected: 0, total: 0, relays: [] };

export const useCollab = create<CollabState>(() => ({
  projectId: null,
  record: null,
  status: 'off',
  providerStatus: 'disconnected',
  signaling: emptySignaling,
  peers: [],
  connectedPeers: 0,
  synced: false,
  fingerprint: null,
  error: null,
  incoming: null,
  following: null,
  shareOpen: false,
  activeCommentId: null,
  commentDraft: null,
  unreadChat: 0,
  openComments: 0,
}));

interface Live {
  session: ProjectSession;
  record: RoomRecord;
  provider: TrysteroProvider;
  awareness: Awareness;
  offs: (() => void)[];
}

let live: Live | null = null;
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

export function getProvider(): TrysteroProvider | null {
  return live?.provider ?? null;
}

export function getLiveAwareness(): Awareness | null {
  return live?.awareness ?? null;
}

/** Create a provider for a room with the current transport settings. */
export function createRoomProvider(
  doc: import('yjs').Doc,
  opts: { room: string; secret: Uint8Array; strategy: SignalingStrategy; role: 'owner' | 'guest'; viewOnly: boolean; awareness?: Awareness },
): TrysteroProvider {
  return new TrysteroProvider(doc, {
    roomId: opts.room,
    secret: opts.secret,
    awareness: opts.awareness,
    role: opts.role,
    viewOnly: opts.viewOnly,
    transport: trysteroTransport(transportOptionsFor(opts.strategy)),
  });
}

// ───────────────────────────── local presence ─────────────────────────────

function localUser(prev?: Partial<PeerUser>): PeerUser {
  const { userName, userColor } = useSettings.getState();
  const fileId = useWorkspace.getState().activeFileId ?? undefined;
  return { ...prev, name: userName || 'Anonymous', color: userColor, colorLight: lightColor(userColor), fileId };
}

function publishLocalUser(aw: Awareness, record: RoomRecord) {
  const prev = (aw.getLocalState()?.user ?? undefined) as Partial<PeerUser> | undefined;
  const next = localUser(prev);
  if (!prev || prev.name !== next.name || prev.color !== next.color || prev.fileId !== next.fileId || prev.colorLight !== next.colorLight) {
    aw.setLocalStateField('user', next);
  }
  const meta: PeerMeta = { uid: useCollabSettings.getState().localUserId, role: record.role, viewOnly: record.viewOnly };
  const prevMeta = aw.getLocalState()?.peer as PeerMeta | undefined;
  if (!prevMeta || prevMeta.uid !== meta.uid || prevMeta.role !== meta.role || prevMeta.viewOnly !== meta.viewOnly) {
    aw.setLocalStateField('peer', meta);
  }
}

// ───────────────────────────── derived state ─────────────────────────────

function computePeers(l: Live): CollabPeerView[] {
  const byClient = new Map(l.provider.peers.filter((p) => p.clientId != null).map((p) => [p.clientId!, p]));
  const out: CollabPeerView[] = [];
  l.awareness.getStates().forEach((state, clientId) => {
    if (clientId === l.awareness.clientID) return;
    const user = state.user as PeerUser | undefined;
    if (!user?.name) return;
    const meta = state.peer as PeerMeta | undefined;
    const tp = byClient.get(clientId);
    out.push({
      clientId,
      peerId: tp?.id,
      name: String(user.name).slice(0, 80),
      color: typeof user.color === 'string' ? user.color : '#888',
      fileId: user.fileId,
      role: meta?.role ?? tp?.role,
      viewOnly: meta?.viewOnly ?? tp?.viewOnly,
      rtt: tp?.rtt,
      direct: !!tp,
      hasCursor: !!state.cursor,
    });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId);
}

function deriveStatus(s: Pick<CollabState, 'record' | 'providerStatus' | 'connectedPeers' | 'signaling'>, paused: boolean): CollabUiStatus {
  if (!s.record) return 'off';
  if (paused) return 'paused';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (s.connectedPeers > 0) return 'live';
  if (s.providerStatus === 'disconnected') return 'connecting';
  if (s.signaling.connected > 0) return 'waiting';
  return 'connecting';
}

let paused = false;

function refresh(patch: Partial<CollabState> = {}) {
  const cur = { ...useCollab.getState(), ...patch };
  const status = deriveStatus(cur, paused);
  useCollab.setState({ ...patch, status });
}

let peersTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce peer-list updates (timer, not rAF: rAF is paused in background tabs). */
function schedulePeers() {
  if (peersTimer) return;
  peersTimer = setTimeout(() => {
    peersTimer = null;
    if (!live) return;
    refresh({ peers: computePeers(live), connectedPeers: live.provider.peers.length });
  }, 32);
}

// ───────────────────────────── connect / teardown ─────────────────────────────

async function connectLive(session: ProjectSession, record: RoomRecord) {
  const awareness = new Awareness(session.project.doc);
  publishLocalUser(awareness, record);
  const provider = createRoomProvider(session.project.doc, {
    room: record.room,
    secret: fromBase64Url(record.secret),
    strategy: record.strategy,
    role: record.role,
    viewOnly: record.viewOnly,
    awareness,
  });
  const l: Live = { session, record, provider, awareness, offs: [] };
  live = l;
  paused = false;
  refresh({
    projectId: session.id,
    record,
    providerStatus: provider.status,
    signaling: provider.signaling,
    peers: [],
    connectedPeers: 0,
    synced: false,
    error: null,
    fingerprint: null,
    incoming: null,
  });

  const onAw = () => schedulePeers();
  awareness.on('change', onAw);
  l.offs.push(() => awareness.off('change', onAw));
  l.offs.push(
    provider.on('status', (s) => refresh({ providerStatus: s })),
    provider.on('peers', () => schedulePeers()),
    provider.on('synced', (synced) => refresh({ synced, error: null })),
    provider.on('signaling', (signaling) => refresh({ signaling })),
    provider.on('progress', (p) => refresh({ incoming: p ? { received: p.received, total: p.total } : null })),
    provider.on('error', (error) => refresh({ error })),
  );
  // Keep presence up to date with the profile and the active file.
  l.offs.push(
    useSettings.subscribe((s, prev) => {
      if (s.userName !== prev.userName || s.userColor !== prev.userColor) publishLocalUser(awareness, record);
    }),
    useWorkspace.subscribe((s, prev) => {
      if (s.activeFileId !== prev.activeFileId) publishLocalUser(awareness, record);
    }),
  );
  const onNet = () => refresh();
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  l.offs.push(() => {
    window.removeEventListener('online', onNet);
    window.removeEventListener('offline', onNet);
  });
  const onUnload = () => void provider.disconnect();
  window.addEventListener('pagehide', onUnload);
  l.offs.push(() => window.removeEventListener('pagehide', onUnload));

  setAwareness(awareness);
  void provider.whenSynced().then(() => refresh({ fingerprint: provider.fingerprint }));
  // Fingerprint is available as soon as keys are derived.
  setTimeout(() => live === l && refresh({ fingerprint: provider.fingerprint }), 300);
}

async function teardownLive(opts: { keepState?: boolean } = {}) {
  const l = live;
  live = null;
  if (!l) return;
  setAwareness(null);
  for (const off of l.offs) off();
  useCollab.setState({ following: null });
  await l.provider.destroy().catch(() => {});
  l.awareness.destroy();
  if (!opts.keepState) {
    paused = false;
    refresh({
      record: null,
      providerStatus: 'disconnected',
      signaling: emptySignaling,
      peers: [],
      connectedPeers: 0,
      synced: false,
      error: null,
      fingerprint: null,
      incoming: null,
    });
  }
}

async function onSessionChanged(session: ProjectSession | null) {
  if (live && live.session === session) return;
  await teardownLive();
  useCollab.setState({ projectId: session?.id ?? null, commentDraft: null, activeCommentId: null });
  if (!session) return;
  const record = await getRoomRecord(session.id);
  if (useWorkspace.getState().session !== session || !record) return;
  await connectLive(session, record);
}

/** Start watching workspace sessions. Returns a disposer. */
export function initCollabSessions(): () => void {
  const unsub = useWorkspace.subscribe((s, prev) => {
    if (s.session !== prev.session) void serial(() => onSessionChanged(s.session));
  });
  const initial = useWorkspace.getState().session;
  if (initial) void serial(() => onSessionChanged(initial));
  return () => {
    unsub();
    void serial(() => teardownLive());
  };
}

// ───────────────────────────── actions ─────────────────────────────

/** Share the open project: new room id + 256-bit secret. */
export function startSharing(): Promise<void> {
  return serial(async () => {
    const session = useWorkspace.getState().session;
    if (!session || live) return;
    const record: RoomRecord = {
      projectId: session.id,
      room: generateRoomId(),
      secret: toBase64Url(generateSecret()),
      role: 'owner',
      viewOnly: false,
      strategy: useCollabSettings.getState().strategy,
      createdAt: Date.now(),
    };
    await saveRoomRecord(record);
    await updateSummary(session.id, { collab: { room: record.room, role: 'owner' } });
    await connectLive(session, record);
  });
}

/**
 * Stop sharing. With `rotate`, immediately re-share under a new room id and
 * secret: existing invite links stop working, collaborators must be re-invited.
 */
export function stopSharing(opts: { rotate?: boolean } = {}): Promise<void> {
  return serial(async () => {
    const session = useWorkspace.getState().session;
    if (!session) return;
    const prev = live?.record ?? (await getRoomRecord(session.id));
    await teardownLive();
    if (opts.rotate && prev) {
      const record: RoomRecord = { ...prev, room: generateRoomId(), secret: toBase64Url(generateSecret()), createdAt: Date.now() };
      await saveRoomRecord(record);
      await updateSummary(session.id, { collab: { room: record.room, role: prev.role } });
      await connectLive(session, record);
      return;
    }
    await deleteRoomRecord(session.id);
    await updateSummary(session.id, { collab: undefined });
  });
}

/** Guests: stop syncing this project (the local copy stays). */
export const leaveSession = () => stopSharing();

/** Temporarily go offline / come back without forgetting the room. */
export function setPaused(p: boolean): Promise<void> {
  return serial(async () => {
    if (!live) return;
    paused = p;
    if (p) await live.provider.disconnect();
    else await live.provider.connect();
    refresh();
  });
}

export function isPaused() {
  return paused;
}

export function reconnectNow(): Promise<void> {
  return serial(async () => {
    if (live && !paused) await live.provider.reconnect();
  });
}

export function inviteLink(viewOnly = false): string | null {
  const s = useCollab.getState();
  const rec = s.record;
  if (!rec) return null;
  // View-only guests can only pass on view-only links (best-effort).
  const vo = viewOnly || rec.viewOnly;
  const name = useWorkspace.getState().meta?.name ?? 'Shared project';
  return buildInviteLink({ room: rec.room, secret: rec.secret, name, viewOnly: vo, strategy: rec.strategy }, useCollabSettings.getState().inviteBaseUrl);
}

export function isViewOnly(): boolean {
  return !!useCollab.getState().record?.viewOnly;
}

export function openShareDialog(open = true) {
  useCollab.setState({ shareOpen: open });
}
