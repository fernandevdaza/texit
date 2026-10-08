/**
 * Per-project room records (room id + secret) and invite links.
 *
 * Records live in their own IndexedDB database (`texit-collab/rooms`), never in
 * localStorage, logs or the project index. The project summary only carries
 * `{ room, role }` so the dashboard can show a "shared" badge.
 */
import { createStore, del, get, set, values } from 'idb-keyval';
import { fromBase64Url, toBase64Url } from './crypto';
import type { SignalingStrategy } from './transport';
import { t } from '@/lib/i18n';

export interface RoomRecord {
  projectId: string;
  room: string;
  /** base64url room secret. */
  secret: string;
  role: 'owner' | 'guest';
  /** Joined through a view-only invite (best-effort, enforced by the UI only). */
  viewOnly: boolean;
  strategy: SignalingStrategy;
  createdAt: number;
}

const store = typeof indexedDB !== 'undefined' ? createStore('texit-collab', 'rooms') : undefined;

export async function getRoomRecord(projectId: string): Promise<RoomRecord | undefined> {
  return store ? get<RoomRecord>(projectId, store) : undefined;
}

export async function saveRoomRecord(rec: RoomRecord): Promise<void> {
  if (store) await set(rec.projectId, rec, store);
}

export async function deleteRoomRecord(projectId: string): Promise<void> {
  if (store) await del(projectId, store);
}

export async function findRoomRecordByRoom(room: string): Promise<RoomRecord | undefined> {
  if (!store) return undefined;
  const all = (await values(store)) as RoomRecord[];
  return all.find((r) => r.room === room);
}

// ───────────────────────────── invite links ─────────────────────────────

const STRATEGIES: SignalingStrategy[] = ['nostr', 'torrent', 'mqtt'];
const ROOM_RE = /^[A-Za-z0-9_-]{6,64}$/;

export interface InviteParams {
  room: string;
  secret: string;
  name: string;
  viewOnly?: boolean;
  strategy: SignalingStrategy;
}

/** `${origin}${pathname}#/join/<room>?k=<secret>&n=<name>[&v=1][&s=<strategy>]` — everything after `#` stays client-side. */
export function buildInviteLink(p: InviteParams, base?: string): string {
  const root = (base?.trim() || `${location.origin}${location.pathname}`).replace(/#.*$/, '');
  const q = new URLSearchParams();
  q.set('k', p.secret);
  q.set('n', p.name);
  if (p.viewOnly) q.set('v', '1');
  if (p.strategy !== 'nostr') q.set('s', p.strategy);
  return `${root}#/join/${p.room}?${q.toString().replace(/\+/g, '%20')}`;
}

export type ParsedInvite =
  | { ok: true; room: string; secret: Uint8Array; secretB64: string; name: string; viewOnly: boolean; strategy: SignalingStrategy }
  | { ok: false; room: string; error: 'missing-key' | 'invalid-key' | 'invalid-room' };

/** Parse the current `#/join/<room>?…` location (route param + hash query, with a search-string fallback). */
export function parseInvite(routeRoom: string, hash = location.hash, search = location.search): ParsedInvite {
  const room = decodeURIComponent(routeRoom.split('?')[0] ?? '');
  const qi = hash.indexOf('?');
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : search.replace(/^\?/, ''));
  if (!ROOM_RE.test(room)) return { ok: false, room, error: 'invalid-room' };
  const k = params.get('k');
  if (!k) return { ok: false, room, error: 'missing-key' };
  let secret: Uint8Array;
  try {
    secret = fromBase64Url(k);
  } catch {
    return { ok: false, room, error: 'invalid-key' };
  }
  if (secret.length < 16) return { ok: false, room, error: 'invalid-key' };
  const s = params.get('s') as SignalingStrategy | null;
  return {
    ok: true,
    room,
    secret,
    secretB64: toBase64Url(secret),
    name: (params.get('n') ?? '').trim().slice(0, 200) || t('collab.sharedProject'),
    viewOnly: params.get('v') === '1',
    strategy: s && STRATEGIES.includes(s) ? s : 'nostr',
  };
}
