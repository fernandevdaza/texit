/**
 * TrysteroProvider — a serverless Yjs provider.
 *
 * Syncs a Y.Doc + Awareness with every peer of a room over a pluggable
 * `Transport` (Trystero WebRTC in the app, in-memory in tests).
 *
 * Wire stack (outermost first):
 *   transport frame  → framing.ts   (chunking under the transport's frame limit)
 *   envelope         → crypto.ts    (AES-GCM-256, key derived from the room secret)
 *   message          → [type : varUint][body…] (lib0 encoding)
 *
 * Messages:
 *   SYNC (0)            y-protocols sync: step 1 (state vector) / step 2 (diff) / update
 *   AWARENESS (1)       y-protocols awareness update
 *   QUERY_AWARENESS (3) ask a peer for its full awareness
 *   HELLO (4)           JSON { v, clientId, role, viewOnly } — maps peer id ↔ Yjs client id
 *   PEERS (5)           JSON [peerId…] — the sender's direct neighbours (partial-mesh routing)
 *   BYE (6)             graceful leave
 *   SIGNED (7)          [inner message][Ed25519 signature] — protocol 2 rooms
 *
 * Signed rooms (protocol 2, see crypto.ts): editors wrap every SYNC message in
 * SIGNED. Peers apply document changes (sync step 2 / update) only from
 * correctly signed messages; unsigned ones are dropped. Readers cannot sign:
 * they only send sync step 1 (state-vector requests), awareness and control
 * messages, never answer step 1 with their own state, and forward editors'
 * signed updates verbatim (signature intact) for partial meshes.
 *
 * Protocol: on peer join both sides send HELLO + SYNC step 1 + awareness; a
 * step 1 is answered with step 2 (only what the asker lacks). Local updates
 * are coalesced (`batchMs`) with Y.mergeUpdates and broadcast. Updates and
 * awareness received from peer X are re-broadcast to peers that are not known
 * to be directly connected to X (so a partial mesh — e.g. one NAT-blocked
 * pair — still converges). A periodic step 1 (`resyncIntervalMs`) repairs
 * anything lost. Re-applying known updates is a no-op in Yjs, so forwarding
 * can't loop.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';
import { decrypt, deriveKeysFor, encrypt, signMessage, verifyMessage, type RoomCredentials, type RoomKeys } from './crypto';
import { frameMessage, Reassembler, type ReassemblyProgress } from './framing';
import type { SignalingState, Transport, TransportFactory } from './transport';

export const PROTOCOL_VERSION = 2;

export const MSG = {
  sync: 0,
  awareness: 1,
  queryAwareness: 3,
  hello: 4,
  peers: 5,
  bye: 6,
  signed: 7,
} as const;

/** y-protocols sync sub-types. */
const SYNC_STEP1 = syncProtocol.messageYjsSyncStep1;

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

export interface PeerHello {
  v: number;
  clientId: number;
  role?: 'owner' | 'guest';
  viewOnly?: boolean;
  /** Room protocol (2 = signed). */
  protocol?: number;
}

export interface ProviderPeer {
  /** Transport peer id. */
  id: string;
  /** Yjs client id announced in HELLO. */
  clientId: number | null;
  role?: 'owner' | 'guest';
  viewOnly?: boolean;
  /** Room protocol announced in HELLO (2 = signed room). */
  protocol?: number;
  /** We received this peer's sync step 2 (we have everything it had). */
  synced: boolean;
  joinedAt: number;
  /** Round-trip time in ms (when the transport supports ping). */
  rtt?: number;
  /** Peers this peer is directly connected to (from its PEERS message). */
  neighbors: Set<string>;
}

export interface ProviderEvents {
  status: ProviderStatus;
  peers: ProviderPeer[];
  synced: boolean;
  signaling: SignalingState;
  /** Progress of a large incoming message (null when finished). */
  progress: ReassemblyProgress | null;
  error: string;
  /** Document changes from this peer were dropped (missing / invalid signature). */
  rejected: { peerId: string; reason: 'unsigned' | 'bad-signature' };
}

export interface TrysteroProviderOptions {
  roomId: string;
  /** Legacy room secret (protocol 1). Prefer `credentials`. Never logged. */
  secret?: Uint8Array;
  /** Room credentials (protocol 1 or 2). Never logged. */
  credentials?: RoomCredentials;
  transport: TransportFactory;
  /** Existing awareness (created and destroyed by the caller); otherwise one is created. */
  awareness?: Awareness;
  /** Announced to peers in HELLO. */
  role?: 'owner' | 'guest';
  viewOnly?: boolean;
  /** Connect immediately (default true). */
  connect?: boolean;
  /** Coalescing window for local updates in ms (default 10; 0 = next microtask). */
  batchMs?: number;
  /** Periodic anti-entropy sync step 1 (default 30 s; 0 disables). */
  resyncIntervalMs?: number;
  /** Re-broadcast updates for partial meshes (default true). */
  forward?: boolean;
  /** Reconnect backoff bounds. */
  reconnect?: { minMs?: number; maxMs?: number };
  /** Rejoin the room when no peer and no signaling relay is reachable for this long (default 30 s; 0 disables). */
  stallRejoinMs?: number;
  /** Peer RTT measurement interval (default 10 s; 0 disables). */
  pingIntervalMs?: number;
}

/** Transaction / awareness origin for changes received from a peer. */
class RemoteOrigin {
  constructor(
    readonly provider: TrysteroProvider,
    readonly peerId: string,
  ) {}
}

/** Origin for local bookkeeping changes that must not be broadcast. */
const LOCAL_ONLY = Symbol('texit-collab-local-only');

type Listener<T> = (value: T) => void;

export class TrysteroProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly roomId: string;

  private readonly factory: TransportFactory;
  private readonly ownsAwareness: boolean;
  private readonly opts: Required<Pick<TrysteroProviderOptions, 'batchMs' | 'resyncIntervalMs' | 'forward' | 'stallRejoinMs' | 'pingIntervalMs'>> & {
    minBackoff: number;
    maxBackoff: number;
  };
  private readonly hello: PeerHello;
  private keysPromise: Promise<RoomKeys>;
  private keys: RoomKeys | null = null;

  private transport: Transport | null = null;
  private generation = 0;
  private opening: Promise<void> | null = null;
  private shouldConnect = false;
  private destroyed = false;

  private _status: ProviderStatus = 'disconnected';
  private _synced = false;
  private _peers = new Map<string, ProviderPeer>();
  private earlyPeers = new Set<string>();
  private origins = new Map<string, RemoteOrigin>();
  private _signaling: SignalingState = { connected: 0, total: 0, relays: [] };

  private reassembler: Reassembler;
  private msgId = Math.floor(Math.random() * 0x7fffffff);
  private sendChain: Promise<unknown> = Promise.resolve();
  private recvChain: Promise<unknown> = Promise.resolve();
  private pendingUpdates: Uint8Array[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchQueued = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffAttempt = 0;
  private stalledSince = 0;
  private decryptErrorReported = new Set<string>();
  private rejectedReported = new Set<string>();
  /**
   * Readers of a signed room: the editors' signed messages that changed our
   * document, replayed verbatim to peers that ask (sync step 1) — a reader can't
   * produce a signed state of its own. Bounded; oldest entries are dropped.
   */
  private signedLog: Uint8Array[] = [];
  private signedLogBytes = 0;
  private listeners: { [K in keyof ProviderEvents]?: Set<Listener<ProviderEvents[K]>> } = {};

  constructor(doc: Y.Doc, options: TrysteroProviderOptions) {
    this.doc = doc;
    this.roomId = options.roomId;
    this.factory = options.transport;
    this.ownsAwareness = !options.awareness;
    this.awareness = options.awareness ?? new Awareness(doc);
    this.opts = {
      batchMs: options.batchMs ?? 10,
      resyncIntervalMs: options.resyncIntervalMs ?? 30_000,
      forward: options.forward ?? true,
      stallRejoinMs: options.stallRejoinMs ?? 30_000,
      pingIntervalMs: options.pingIntervalMs ?? 10_000,
      minBackoff: options.reconnect?.minMs ?? 1000,
      maxBackoff: options.reconnect?.maxMs ?? 30_000,
    };
    const creds = copyCredentials(options);
    this.hello = { v: PROTOCOL_VERSION, clientId: doc.clientID, role: options.role, viewOnly: options.viewOnly, protocol: creds.protocol };
    this.reassembler = new Reassembler({
      onProgress: (p) => {
        if (p.total < 8) return;
        this.emit('progress', p.received >= p.total ? null : p);
      },
    });
    this.keysPromise = deriveKeysFor(creds, options.roomId).then((k) => (this.keys = k));
    this.keysPromise.catch(() => {});

    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    if (options.connect !== false) void this.connect();
  }

  // ───────────────────────────── public API ─────────────────────────────

  get status(): ProviderStatus {
    return this._status;
  }
  /** True once at least one peer sent us its full state (sync step 2). */
  get synced(): boolean {
    return this._synced;
  }
  get peers(): ProviderPeer[] {
    return Array.from(this._peers.values());
  }
  get signaling(): SignalingState {
    return this._signaling;
  }
  get selfId(): string | null {
    return this.transport?.selfId ?? null;
  }
  get connected(): boolean {
    return this.shouldConnect;
  }
  /** Signed room (protocol 2) — read-only access is enforced cryptographically. */
  get signed(): boolean {
    return this.keys?.protocol === 2;
  }
  /** False for readers of a signed room (their document changes are not sent nor accepted). */
  get canWrite(): boolean {
    return this.keys?.canWrite ?? true;
  }
  /** Key fingerprint (for out-of-band verification); null until derived. */
  get fingerprint(): string | null {
    return this.keys?.fingerprint ?? null;
  }

  on<K extends keyof ProviderEvents>(event: K, cb: Listener<ProviderEvents[K]>): () => void {
    const map = this.listeners as Record<string, Set<Listener<any>> | undefined>;
    const set = (map[event] ??= new Set());
    set.add(cb);
    return () => void set.delete(cb);
  }

  /** Resolves when synced with at least one peer (rejects on timeout / destroy). */
  whenSynced(timeoutMs = 0): Promise<void> {
    if (this._synced) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const off = this.on('synced', (s) => {
        if (!s) return;
        off();
        clearTimeout(timer);
        resolve();
      });
      if (timeoutMs > 0)
        timer = setTimeout(() => {
          off();
          reject(new Error('Timed out waiting for peers'));
        }, timeoutMs);
    });
  }

  connect(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Provider destroyed'));
    this.shouldConnect = true;
    if (this.transport) return Promise.resolve();
    if (this.opening) return this.opening;
    this.setStatus('connecting');
    this.opening = this.open().finally(() => (this.opening = null));
    return this.opening;
  }

  /** Gracefully leave: tell peers we're gone (awareness null + BYE), then close the transport. */
  async disconnect(): Promise<void> {
    this.shouldConnect = false;
    this.clearReconnect();
    this.stopTimers();
    const t = this.transport;
    if (t) {
      this.flushUpdates();
      const id = this.doc.clientID;
      const sends: Promise<void>[] = [];
      if (this.awareness.meta.has(id) && this._peers.size) {
        const upd = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [id], new Map([[id, null]]) as Map<number, any>);
        sends.push(this.sendPlain(encodeAwareness(upd)));
      }
      if (this._peers.size) sends.push(this.sendPlain(encodeSimple(MSG.bye)));
      await Promise.race([Promise.allSettled(sends), sleep(1000)]);
      await sleep(30); // let the data channel drain the last frames
      await this.closeTransport();
    } else {
      this.generation++;
    }
    await this.opening?.catch(() => {});
    this.dropAllPeers();
    this.setStatus('disconnected');
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    await this.disconnect().catch(() => {});
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    if (this.ownsAwareness) this.awareness.destroy();
    this.reassembler.clear();
    for (const k of Object.keys(this.listeners)) delete this.listeners[k as keyof ProviderEvents];
  }

  /** Force an immediate anti-entropy round with every peer. */
  resync(): void {
    this.sendPlain(encodeSyncStep1(this.doc));
  }

  /** Leave and rejoin the room now (resets backoff). */
  async reconnect(): Promise<void> {
    this.backoffAttempt = 0;
    this.clearReconnect();
    await this.closeTransport();
    this.dropAllPeers();
    if (this.shouldConnect) await this.connect();
  }

  // ───────────────────────────── transport lifecycle ─────────────────────────────

  private async open(): Promise<void> {
    const gen = ++this.generation;
    try {
      const keys = await this.keysPromise;
      if (gen !== this.generation || !this.shouldConnect) return;
      const t = await this.factory(
        { roomId: this.roomId, password: keys.signalingPassword },
        {
          onPeerJoin: (id) => gen === this.generation && this.handlePeerJoin(id),
          onPeerLeave: (id) => gen === this.generation && this.handlePeerLeave(id),
          onMessage: (frame, id) => gen === this.generation && this.handleFrame(frame, id),
          onSignaling: (s) => {
            if (gen !== this.generation) return;
            this._signaling = s;
            this.emit('signaling', s);
          },
          onError: (msg) => gen === this.generation && this.emit('error', msg),
        },
      );
      if (gen !== this.generation || !this.shouldConnect || this.destroyed) {
        await t.leave();
        return;
      }
      this.transport = t;
      this.backoffAttempt = 0;
      this.stalledSince = Date.now();
      this.startTimers();
      const initial = new Set([...this.earlyPeers, ...t.peers()]);
      this.earlyPeers.clear();
      for (const id of initial) this.handlePeerJoin(id);
      this.updateStatus();
    } catch (err) {
      if (gen !== this.generation) return;
      this.emit('error', `Could not join the collaboration room: ${(err as Error)?.message ?? err}`);
      this.scheduleReconnect();
    }
  }

  private async closeTransport() {
    this.generation++;
    this.stopTimers();
    const t = this.transport;
    this.transport = null;
    if (t) await t.leave().catch(() => {});
  }

  private scheduleReconnect() {
    if (!this.shouldConnect || this.destroyed || this.reconnectTimer) return;
    const base = Math.min(this.opts.maxBackoff, this.opts.minBackoff * 2 ** this.backoffAttempt);
    const delay = base * (0.75 + Math.random() * 0.5);
    this.backoffAttempt++;
    this.setStatus('connecting');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldConnect || this.destroyed) return;
      await this.closeTransport();
      this.dropAllPeers();
      void this.connect();
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private onOnline = () => {
    if (this.shouldConnect && this._peers.size === 0) void this.reconnect();
  };

  private startTimers() {
    this.stopTimers();
    if (this.opts.resyncIntervalMs > 0) this.timers.push(setInterval(() => this._peers.size && this.resync(), this.opts.resyncIntervalMs));
    this.timers.push(
      setInterval(() => {
        this.reassembler.gc();
        // Stall watchdog: no peers and no reachable signaling for a while → rejoin with backoff.
        if (this._peers.size || this._signaling.connected > 0 || this._signaling.total === 0) {
          this.stalledSince = Date.now();
        } else if (this.opts.stallRejoinMs > 0 && Date.now() - this.stalledSince > this.opts.stallRejoinMs) {
          this.stalledSince = Date.now();
          this.scheduleReconnect();
        }
      }, 5000),
    );
    if (this.opts.pingIntervalMs > 0)
      this.timers.push(
        setInterval(() => {
          const t = this.transport;
          if (!t?.ping) return;
          for (const p of this._peers.values()) {
            t.ping(p.id)
              .then((ms) => {
                const cur = this._peers.get(p.id);
                if (cur && Number.isFinite(ms)) {
                  cur.rtt = Math.round(ms);
                  this.emitPeers();
                }
              })
              .catch(() => {});
          }
        }, this.opts.pingIntervalMs),
      );
  }

  private stopTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ───────────────────────────── peers ─────────────────────────────

  private handlePeerJoin(id: string) {
    if (!this.transport) {
      this.earlyPeers.add(id);
      return;
    }
    if (this._peers.has(id)) return;
    this._peers.set(id, { id, clientId: null, synced: false, joinedAt: Date.now(), neighbors: new Set() });
    this.updateStatus();
    this.emitPeers();
    // Greet: identity, our state vector, everything we know about presence.
    this.sendPlain(encodeJson(MSG.hello, this.hello), id);
    this.sendPlain(encodeSyncStep1(this.doc), id);
    const states = Array.from(this.awareness.getStates().keys());
    if (states.length) this.sendPlain(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)), id);
    this.broadcastNeighbors();
  }

  private handlePeerLeave(id: string) {
    this.earlyPeers.delete(id);
    const p = this._peers.get(id);
    if (!p) return;
    this._peers.delete(id);
    this.origins.delete(id);
    this.reassembler.clearPeer(id);
    if (p.clientId != null && p.clientId !== this.doc.clientID && this.awareness.states.has(p.clientId)) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [p.clientId], LOCAL_ONLY);
    }
    this.updateStatus();
    this.emitPeers();
    this.broadcastNeighbors();
  }

  private dropAllPeers() {
    this.earlyPeers.clear();
    const remote = Array.from(this.awareness.getStates().keys()).filter((c) => c !== this.doc.clientID);
    if (remote.length) awarenessProtocol.removeAwarenessStates(this.awareness, remote, LOCAL_ONLY);
    this._peers.clear();
    this.origins.clear();
    this.reassembler.clear();
    this.emitPeers();
  }

  private broadcastNeighbors() {
    if (!this._peers.size) return;
    this.sendPlain(encodeJson(MSG.peers, Array.from(this._peers.keys())));
  }

  private origin(peerId: string): RemoteOrigin {
    let o = this.origins.get(peerId);
    if (!o) this.origins.set(peerId, (o = new RemoteOrigin(this, peerId)));
    return o;
  }

  /** Peers that should receive something that came from `source` (excluding peers directly linked to it). */
  private forwardTargets(source: string): string[] {
    const out: string[] = [];
    for (const p of this._peers.values()) {
      if (p.id === source || p.neighbors.has(source)) continue;
      out.push(p.id);
    }
    return out;
  }

  // ───────────────────────────── receiving ─────────────────────────────

  private handleFrame(frame: Uint8Array, peerId: string) {
    let envelope: Uint8Array | null;
    try {
      envelope = this.reassembler.push(peerId, frame);
    } catch {
      return; // malformed frame: ignore
    }
    if (!envelope) return;
    const env = envelope;
    this.recvChain = this.recvChain.then(() => this.handleEnvelope(env, peerId)).catch((err) => {
      this.emit('error', `Collaboration message error: ${(err as Error)?.message ?? err}`);
    });
  }

  private async handleEnvelope(envelope: Uint8Array, peerId: string) {
    const keys = this.keys ?? (await this.keysPromise);
    let plain: Uint8Array;
    try {
      plain = await decrypt(keys, envelope);
    } catch {
      if (!this.decryptErrorReported.has(peerId)) {
        this.decryptErrorReported.add(peerId);
        this.emit('error', 'A peer sent data that could not be decrypted (it may be using an outdated invite link).');
      }
      return;
    }
    if (!this.transport) return;
    if (!this._peers.has(peerId)) this.handlePeerJoin(peerId);
    const peer = this._peers.get(peerId);
    if (!peer) return;
    await this.processMessage(plain, peer, keys, false);
  }

  private rememberSigned(message: Uint8Array) {
    const MAX = 32 * 1024 * 1024;
    this.signedLog.push(message);
    this.signedLogBytes += message.length;
    while (this.signedLogBytes > MAX && this.signedLog.length > 1) this.signedLogBytes -= this.signedLog.shift()!.length;
  }

  private reject(peerId: string, reason: 'unsigned' | 'bad-signature') {
    this.emit('rejected', { peerId, reason });
    if (this.rejectedReported.has(peerId)) return;
    this.rejectedReported.add(peerId);
    this.emit('error', 'Ignored changes from a read-only participant (they were not signed by an editor).');
  }

  private async processMessage(plain: Uint8Array, peer: ProviderPeer, keys: RoomKeys, trusted: boolean): Promise<void> {
    const peerId = peer.id;
    const decoder = decoding.createDecoder(plain);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MSG.signed: {
        if (keys.protocol !== 2 || trusted) break; // signatures only exist in signed rooms; no nesting
        const inner = decoding.readVarUint8Array(decoder);
        const signature = decoding.readVarUint8Array(decoder);
        if (!(await verifyMessage(keys, inner, signature))) {
          this.reject(peerId, 'bad-signature');
          break;
        }
        await this.processMessage(inner, peer, keys, true);
        const innerType = peekSyncType(inner);
        if (!keys.canWrite && innerType !== SYNC_STEP1 && innerType !== -1) {
          this.rememberSigned(plain);
          // Readers can't re-sign: forward editors' signed updates verbatim so partial meshes still converge.
          if (this.opts.forward && innerType === syncProtocol.messageYjsUpdate) {
            const targets = this.forwardTargets(peerId);
            if (targets.length) this.sendPlain(plain, targets);
          }
        }
        break;
      }
      case MSG.sync: {
        const syncType = peekSyncType(plain);
        // Signed rooms: only signed messages may change the document.
        if (keys.protocol === 2 && !trusted && syncType !== SYNC_STEP1) {
          this.reject(peerId, 'unsigned');
          break;
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG.sync);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this.origin(peerId), (err) =>
          this.emit('error', `Could not apply a remote update: ${err.message}`),
        );
        // Readers of a signed room can't sign their state: they replay the editors' signed messages instead.
        if (encoding.length(encoder) > 1 && keys.canWrite) this.sendPlain(encoding.toUint8Array(encoder), peerId);
        else if (!keys.canWrite && syncType === SYNC_STEP1) for (const m of this.signedLog) this.sendPlain(m, peerId);
        if (syncType === syncProtocol.messageYjsSyncStep2 && !peer.synced) {
          peer.synced = true;
          this.emitPeers();
          if (!this._synced) {
            this._synced = true;
            this.emit('synced', true);
          }
        }
        break;
      }
      case MSG.awareness:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this.origin(peerId));
        break;
      case MSG.queryAwareness: {
        const states = Array.from(this.awareness.getStates().keys());
        if (states.length) this.sendPlain(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)), peerId);
        break;
      }
      case MSG.hello: {
        const h = safeJson(decoding.readVarString(decoder)) as PeerHello | null;
        if (!h || typeof h.clientId !== 'number') break;
        if (h.v > PROTOCOL_VERSION) this.emit('error', 'A collaborator is using a newer version of TexIt — please update.');
        peer.clientId = h.clientId;
        peer.role = h.role;
        peer.viewOnly = !!h.viewOnly;
        peer.protocol = typeof h.protocol === 'number' ? h.protocol : 1;
        this.emitPeers();
        break;
      }
      case MSG.peers: {
        const ids = safeJson(decoding.readVarString(decoder));
        if (Array.isArray(ids)) peer.neighbors = new Set(ids.filter((x): x is string => typeof x === 'string'));
        break;
      }
      case MSG.bye: {
        if (peer.clientId != null && this.awareness.states.has(peer.clientId)) {
          awarenessProtocol.removeAwarenessStates(this.awareness, [peer.clientId], LOCAL_ONLY);
        }
        break;
      }
      default:
        break; // unknown (newer) message type: ignore
    }
  }

  // ───────────────────────────── sending ─────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Readers of a signed room: local changes are never accepted by peers, and
    // remote updates are forwarded verbatim (signed) from processMessage.
    if (this.keys && !this.keys.canWrite) return;
    if (origin instanceof RemoteOrigin) {
      if (origin.provider !== this || !this.opts.forward) return;
      const targets = this.forwardTargets(origin.peerId);
      if (targets.length) this.sendPlain(encodeUpdate(update), targets);
      return;
    }
    if (!this.transport || !this._peers.size) return; // peers will get it through sync step 2
    this.pendingUpdates.push(update);
    if (this.opts.batchMs <= 0) {
      if (!this.batchQueued) {
        this.batchQueued = true;
        queueMicrotask(() => {
          this.batchQueued = false;
          this.flushUpdates();
        });
      }
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushUpdates(), this.opts.batchMs);
    }
  };

  private flushUpdates() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (!this.pendingUpdates.length) return;
    const updates = this.pendingUpdates;
    this.pendingUpdates = [];
    const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
    this.sendPlain(encodeUpdate(merged));
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === LOCAL_ONLY || !this.transport || !this._peers.size) return;
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    if (origin instanceof RemoteOrigin) {
      if (origin.provider !== this || !this.opts.forward) return;
      const targets = this.forwardTargets(origin.peerId);
      if (targets.length) this.sendPlain(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)), targets);
      return;
    }
    this.sendPlain(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
  };

  /**
   * Encrypt + frame + send. Encryption is serialized so messages leave in
   * order; frames of a large message are sent sequentially in the background
   * so small messages can interleave. Resolves once handed to the transport.
   */
  private sendPlain(plain: Uint8Array, target?: string | string[]): Promise<void> {
    const t = this.transport;
    if (!t) return Promise.resolve();
    if (!target && !this._peers.size) return Promise.resolve();
    if (Array.isArray(target) && !target.length) return Promise.resolve();
    const step = this.sendChain.then(async () => {
      if (this.transport !== t) return;
      const keys = this.keys ?? (await this.keysPromise);
      // Signed rooms: editors sign every SYNC message (readers can't; peers drop their changes).
      const payload = keys.signKey && plain[0] === MSG.sync ? encodeSigned(plain, await signMessage(keys, plain)) : plain;
      const env = await encrypt(keys, payload);
      if (this.transport !== t) return;
      const frames = frameMessage(env, t.maxFrameBytes, this.msgId++ >>> 0);
      if (frames.length === 1) return { done: t.send(frames[0], target) };
      const done = (async () => {
        for (const f of frames) {
          if (this.transport !== t) return;
          await t.send(f, target);
        }
      })();
      return { done };
    });
    this.sendChain = step.catch(() => {});
    return step
      .then((r) => r?.done)
      .catch(() => {
        /* peer vanished mid-send: the next sync round repairs it */
      });
  }

  // ───────────────────────────── state ─────────────────────────────

  private updateStatus() {
    if (!this.shouldConnect) return this.setStatus('disconnected');
    this.setStatus(this.transport && this._peers.size ? 'connected' : 'connecting');
  }

  private setStatus(s: ProviderStatus) {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }

  private emitPeers() {
    this.emit('peers', this.peers);
  }

  private emit<K extends keyof ProviderEvents>(event: K, value: ProviderEvents[K]) {
    const set = this.listeners[event] as Set<Listener<ProviderEvents[K]>> | undefined;
    if (!set) return;
    for (const cb of Array.from(set)) {
      try {
        cb(value);
      } catch (err) {
        console.error('[texit/collab] listener error', err);
      }
    }
  }
}

// ───────────────────────────── encoding helpers ─────────────────────────────

function encodeSimple(type: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  return encoding.toUint8Array(e);
}

function encodeJson(type: number, value: unknown): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  encoding.writeVarString(e, JSON.stringify(value));
  return encoding.toUint8Array(e);
}

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG.sync);
  syncProtocol.writeSyncStep1(e, doc);
  return encoding.toUint8Array(e);
}

function encodeUpdate(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG.sync);
  syncProtocol.writeUpdate(e, update);
  return encoding.toUint8Array(e);
}

function encodeAwareness(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG.awareness);
  encoding.writeVarUint8Array(e, update);
  return encoding.toUint8Array(e);
}

function encodeSigned(inner: Uint8Array, signature: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG.signed);
  encoding.writeVarUint8Array(e, inner);
  encoding.writeVarUint8Array(e, signature);
  return encoding.toUint8Array(e);
}

/** Sync sub-type of a SYNC message (step 1 / step 2 / update), or -1. */
function peekSyncType(message: Uint8Array): number {
  try {
    const d = decoding.createDecoder(message);
    if (decoding.readVarUint(d) !== MSG.sync) return -1;
    return decoding.readVarUint(d);
  } catch {
    return -1;
  }
}

function copyCredentials(o: TrysteroProviderOptions): RoomCredentials {
  // Copies: callers may wipe theirs.
  const c = o.credentials;
  if (!c) {
    if (!o.secret) throw new Error('Room credentials are required');
    return { protocol: 1, secret: new Uint8Array(o.secret) };
  }
  if (c.protocol === 1) return { protocol: 1, secret: new Uint8Array(c.secret) };
  if ('master' in c) return { protocol: 2, master: new Uint8Array(c.master) };
  return { protocol: 2, read: new Uint8Array(c.read), publicKey: new Uint8Array(c.publicKey) };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
