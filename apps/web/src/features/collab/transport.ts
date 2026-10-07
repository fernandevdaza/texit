/**
 * Transport abstraction for the collaboration provider + the Trystero
 * (serverless WebRTC) implementation.
 *
 * The provider only needs: a stable self id, peer join/leave events, and
 * best-effort delivery of binary frames (≤ `maxFrameBytes`) to one, several or
 * all peers. Unit tests plug in an in-memory transport instead.
 */
import type { JoinRoomConfig, MessageAction, Room, TurnServerConfig } from '@trystero-p2p/nostr';

export type SignalingStrategy = 'nostr' | 'torrent' | 'mqtt';

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface SignalingState {
  /** Relays/trackers/brokers with an open socket. */
  connected: number;
  total: number;
  relays: RelayStatus[];
}

export interface TransportHandlers {
  onPeerJoin(peerId: string): void;
  onPeerLeave(peerId: string): void;
  onMessage(frame: Uint8Array, peerId: string): void;
  onSignaling?(state: SignalingState): void;
  onError?(message: string): void;
}

export interface Transport {
  readonly selfId: string;
  /** Largest frame `send` accepts. */
  readonly maxFrameBytes: number;
  /** Send one frame; `target` omitted → all connected peers. */
  send(frame: Uint8Array, target?: string | string[]): Promise<void>;
  peers(): string[];
  ping?(peerId: string): Promise<number>;
  leave(): Promise<void>;
}

export interface TransportRoom {
  roomId: string;
  /** Password for encrypted signaling (derived from the room secret). */
  password: string;
}

export type TransportFactory = (room: TransportRoom, handlers: TransportHandlers) => Promise<Transport>;

// ───────────────────────────── Trystero ─────────────────────────────

export interface TrysteroOptions {
  strategy: SignalingStrategy;
  /** Custom relay URLs (wss://…). Empty → the strategy's public defaults. */
  relayUrls?: string[];
  /** How many default relays to use simultaneously. */
  redundancy?: number;
  /** Full ICE server list (replaces Trystero's default STUN servers). */
  iceServers?: RTCIceServer[];
  /** Extra TURN servers (added on top of the default STUN servers). */
  turnServers?: TurnServerConfig[];
}

/** Namespace for all TexIt rooms on public relays (bump on breaking protocol changes). */
export const TRYSTERO_APP_ID = 'texit-collab-v1';
const ACTION_ID = 'texit-y1';
/** Trystero inlines payloads ≤ 16 KiB minus its 36-byte header; stay below it. */
const TRYSTERO_MAX_FRAME = 16 * 1024 - 64;

interface StrategyModule {
  joinRoom: (config: JoinRoomConfig, roomId: string, callbacks?: { onJoinError?: (d: { error: string }) => void }) => Room;
  selfId: string;
  getRelaySockets: () => Record<string, unknown>;
  defaultRelayUrls: string[];
}

export async function loadStrategy(strategy: SignalingStrategy): Promise<StrategyModule> {
  switch (strategy) {
    case 'torrent':
      return (await import('@trystero-p2p/torrent')) as unknown as StrategyModule;
    case 'mqtt':
      return (await import('@trystero-p2p/mqtt')) as unknown as StrategyModule;
    default:
      return (await import('@trystero-p2p/nostr')) as unknown as StrategyModule;
  }
}

function isOpen(sock: unknown): boolean {
  const s = sock as { readyState?: number; connected?: boolean } | null | undefined;
  if (!s) return false;
  if (typeof s.readyState === 'number') return s.readyState === 1;
  return !!s.connected;
}

function toU8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('Unexpected non-binary payload');
}

/** Pending `room.leave()` per strategy+room, so a quick re-join doesn't get the dying instance. */
const leaving = new Map<string, Promise<void>>();

export function trysteroTransport(opts: TrysteroOptions): TransportFactory {
  return async ({ roomId, password }, h) => {
    const cacheKey = `${opts.strategy}:${roomId}`;
    await leaving.get(cacheKey);
    const mod = await loadStrategy(opts.strategy);
    const urls = (opts.relayUrls ?? []).map((u) => u.trim()).filter(Boolean);
    const config: JoinRoomConfig = {
      appId: TRYSTERO_APP_ID,
      password,
      relayConfig: {
        ...(urls.length ? { urls } : {}),
        ...(opts.redundancy ? { redundancy: opts.redundancy } : {}),
        warnOnRelayFailure: false,
      },
      ...(opts.iceServers?.length ? { rtcConfig: { iceServers: opts.iceServers } } : {}),
      ...(opts.turnServers?.length ? { turnConfig: opts.turnServers } : {}),
    };
    const room = mod.joinRoom(config, `texit:${roomId}`, {
      onJoinError: (d) => h.onError?.(d.error),
    });
    const action = room.makeAction(ACTION_ID) as unknown as MessageAction<Uint8Array>;
    action.onMessage = (data, ctx) => {
      try {
        h.onMessage(toU8(data), ctx.peerId);
      } catch (err) {
        h.onError?.(String((err as Error)?.message ?? err));
      }
    };
    room.onPeerJoin = (id) => h.onPeerJoin(id);
    room.onPeerLeave = (id) => h.onPeerLeave(id);

    // Signaling health (relay sockets are shared per strategy module).
    let lastKey = '';
    const poll = () => {
      let sockets: Record<string, unknown> = {};
      try {
        sockets = mod.getRelaySockets() ?? {};
      } catch {
        /* ignore */
      }
      const relays = Object.entries(sockets).map(([url, s]) => ({ url, connected: isOpen(s) }));
      const state: SignalingState = { connected: relays.filter((r) => r.connected).length, total: relays.length, relays };
      const key = relays.map((r) => `${r.url}:${r.connected ? 1 : 0}`).join('|');
      if (key !== lastKey) {
        lastKey = key;
        h.onSignaling?.(state);
      }
    };
    poll();
    const timer = setInterval(poll, 1500);

    let left = false;
    return {
      selfId: mod.selfId,
      maxFrameBytes: TRYSTERO_MAX_FRAME,
      send: (frame, target) => action.send(frame, target ? { target } : undefined),
      peers: () => Object.keys(room.getPeers()),
      ping: (id) => room.ping(id),
      async leave() {
        if (left) return;
        left = true;
        clearInterval(timer);
        action.onMessage = null;
        room.onPeerJoin = null;
        room.onPeerLeave = null;
        const p = room.leave().catch(() => {});
        leaving.set(cacheKey, p);
        await p;
        if (leaving.get(cacheKey) === p) leaving.delete(cacheKey);
      },
    };
  };
}
