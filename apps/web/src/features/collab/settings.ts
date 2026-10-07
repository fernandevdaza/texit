/**
 * Persisted collaboration settings (localStorage `texit:collab`).
 * Holds no secrets: room secrets live in IndexedDB (see rooms.ts).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SignalingStrategy, TrysteroOptions } from './transport';

export interface IceServerEntry {
  /** One or more URLs separated by spaces/commas: stun:…, turn:…, turns:… */
  urls: string;
  username?: string;
  credential?: string;
}

export interface CollabSettingsState {
  /** Signaling network used when you start sharing a project (invite links carry it). */
  strategy: SignalingStrategy;
  /** Custom relay URLs per strategy (empty → public defaults). */
  relayUrls: Record<SignalingStrategy, string[]>;
  /** Extra STUN/TURN servers. */
  iceServers: IceServerEntry[];
  /** Use only `iceServers` (drop Trystero's default public STUN servers). */
  replaceDefaultIce: boolean;
  /** Base URL for invite links (e.g. the public web app when sharing from the desktop app). Empty → this app's URL. */
  inviteBaseUrl: string;
  /** Stable, random, local identity used to recognise your own chat messages & comments. */
  localUserId: string;
  /** Toast incoming chat messages while the chat panel is hidden. */
  chatToasts: boolean;
  set(patch: Partial<Omit<CollabSettingsState, 'set' | 'setRelayUrls'>>): void;
  setRelayUrls(strategy: SignalingStrategy, urls: string[]): void;
}

const randomId = () => {
  const b = new Uint8Array(9);
  globalThis.crypto?.getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16) || String(Math.random()).slice(2);
};

export const DEFAULT_STRATEGY: SignalingStrategy = 'nostr';

export const useCollabSettings = create<CollabSettingsState>()(
  persist(
    (set) => ({
      strategy: DEFAULT_STRATEGY,
      relayUrls: { nostr: [], torrent: [], mqtt: [] },
      iceServers: [],
      replaceDefaultIce: false,
      inviteBaseUrl: '',
      localUserId: randomId(),
      chatToasts: true,
      set: (patch) => set(patch),
      setRelayUrls: (strategy, urls) => set((s) => ({ relayUrls: { ...s.relayUrls, [strategy]: urls } })),
    }),
    {
      name: 'texit:collab',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CollabSettingsState>;
        return { ...current, ...p, relayUrls: { ...current.relayUrls, ...p.relayUrls } };
      },
    },
  ),
);

export const strategyInfo: Record<SignalingStrategy, { label: string; short: string; description: string }> = {
  nostr: {
    label: 'Nostr relays',
    short: 'Nostr',
    description: 'Hundreds of independent public relays — the most decentralized and redundant option.',
  },
  torrent: {
    label: 'BitTorrent trackers',
    short: 'BitTorrent',
    description: 'Public WebTorrent trackers. Few servers, but simple and widely reachable.',
  },
  mqtt: {
    label: 'MQTT brokers',
    short: 'MQTT',
    description: 'Public MQTT brokers (EMQX, HiveMQ, Mosquitto…). Robust, low-latency signaling.',
  },
};

function splitUrls(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Build Trystero options for a room using the current settings. */
export function transportOptionsFor(strategy: SignalingStrategy): TrysteroOptions {
  const s = useCollabSettings.getState();
  const ice = s.iceServers
    .map((e) => ({ urls: splitUrls(e.urls), username: e.username || undefined, credential: e.credential || undefined }))
    .filter((e) => e.urls.length);
  const opts: TrysteroOptions = { strategy, relayUrls: s.relayUrls[strategy] ?? [] };
  if (ice.length) {
    if (s.replaceDefaultIce) opts.iceServers = ice;
    else opts.turnServers = ice;
  }
  return opts;
}

/** Lighter variant of a color for selections (y-codemirror.next `colorLight`). */
export function lightColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}33` : `color-mix(in srgb, ${color} 20%, transparent)`;
}
