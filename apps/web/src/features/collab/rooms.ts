/**
 * Per-project room records (room id + secret) and invite links.
 *
 * Records live in their own IndexedDB database (`texit-collab/rooms`), never in
 * localStorage, logs or the project index. The project summary only carries
 * `{ room, role }` so the dashboard can show a "shared" badge.
 */
import { createStore, del, get, set, values } from 'idb-keyval';
import { fromBase64Url, toBase64Url, type RoomCredentials } from './crypto';
import type { SignalingStrategy } from './transport';
import { t } from '@/lib/i18n';

export interface RoomRecord {
  projectId: string;
  room: string;
  /**
   * base64url secret: the shared room secret (protocol 1) or the master secret
   * (protocol 2 editors). Empty for protocol 2 readers, who never get it.
   */
  secret: string;
  role: 'owner' | 'guest';
  /** Joined through a view-only invite. Enforced with signatures in protocol 2 rooms, by the UI only in protocol 1. */
  viewOnly: boolean;
  /** 1 = legacy shared secret; 2 = signed room (enforced read-only access). Missing = 1. */
  protocol?: 1 | 2;
  /** Protocol 2: base64url read secret (decrypts; cannot sign). */
  read?: string;
  /** Protocol 2: base64url Ed25519 public key of the editors. */
  publicKey?: string;
  strategy: SignalingStrategy;
  createdAt: number;
}

/** Credentials for connecting with a stored room record. */
export function credentialsOf(rec: RoomRecord): RoomCredentials {
  if (rec.protocol === 2) {
    if (rec.secret && !rec.viewOnly) return { protocol: 2, master: fromBase64Url(rec.secret) };
    if (!rec.read || !rec.publicKey) throw new Error('Incomplete read-only room record');
    return { protocol: 2, read: fromBase64Url(rec.read), publicKey: fromBase64Url(rec.publicKey) };
  }
  return { protocol: 1, secret: fromBase64Url(rec.secret) };
}

/** Read-only access is enforced cryptographically (protocol 2) rather than by the UI only. */
export function isSignedRoom(rec: Pick<RoomRecord, 'protocol'> | null | undefined): boolean {
  return rec?.protocol === 2;
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
  /** Protocol 1 secret or protocol 2 master secret (base64url). */
  secret?: string;
  name: string;
  viewOnly?: boolean;
  strategy: SignalingStrategy;
  protocol?: 1 | 2;
  /** Protocol 2 read secret + editors' public key (base64url), for view links. */
  read?: string;
  publicKey?: string;
}

/**
 * Invite links — everything after `#` stays client-side:
 *   protocol 1:            #/join/<room>?k=<secret>&n=<name>[&v=1][&s=<strategy>]
 *   protocol 2, edit:      #/join/<room>?k=<master>&p=2&n=…
 *   protocol 2, view-only: #/join/<room>?r=<read secret>&pk=<public key>&p=2&v=1&n=…  (no master secret)
 */
export function buildInviteLink(p: InviteParams, base?: string): string {
  const root = (base?.trim() || `${location.origin}${location.pathname}`).replace(/#.*$/, '');
  const q = new URLSearchParams();
  if (p.protocol === 2 && p.viewOnly) {
    if (!p.read || !p.publicKey) throw new Error('Missing read credentials for a view-only link');
    q.set('r', p.read);
    q.set('pk', p.publicKey);
  } else {
    if (!p.secret) throw new Error('Missing room secret for an edit link');
    q.set('k', p.secret);
  }
  if (p.protocol === 2) q.set('p', '2');
  q.set('n', p.name);
  if (p.viewOnly) q.set('v', '1');
  if (p.strategy !== 'nostr') q.set('s', p.strategy);
  return `${root}#/join/${p.room}?${q.toString().replace(/\+/g, '%20')}`;
}

export type ParsedInvite =
  | {
      ok: true;
      room: string;
      credentials: RoomCredentials;
      protocol: 1 | 2;
      /** base64url master (protocol 2 editors) or shared secret (protocol 1); '' for protocol 2 readers. */
      secretB64: string;
      readB64?: string;
      publicKeyB64?: string;
      name: string;
      viewOnly: boolean;
      strategy: SignalingStrategy;
    }
  | { ok: false; room: string; error: 'missing-key' | 'invalid-key' | 'invalid-room' };

/** Parse the current `#/join/<room>?…` location (route param + hash query, with a search-string fallback). */
export function parseInvite(routeRoom: string, hash = location.hash, search = location.search): ParsedInvite {
  const room = decodeURIComponent(routeRoom.split('?')[0] ?? '');
  const qi = hash.indexOf('?');
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : search.replace(/^\?/, ''));
  if (!ROOM_RE.test(room)) return { ok: false, room, error: 'invalid-room' };
  const s = params.get('s') as SignalingStrategy | null;
  const common = {
    room,
    name: (params.get('n') ?? '').trim().slice(0, 200) || t('collab.sharedProject'),
    strategy: s && STRATEGIES.includes(s) ? s : ('nostr' as SignalingStrategy),
  };
  const decode = (v: string | null, min: number, max = 1024): Uint8Array | null => {
    if (!v) return null;
    try {
      const b = fromBase64Url(v);
      return b.length >= min && b.length <= max ? b : null;
    } catch {
      return null;
    }
  };
  const protocol = params.get('p') === '2' ? 2 : 1;
  const k = params.get('k');
  if (protocol === 2 && !k) {
    // Signed room, view-only link: read secret + editors' public key, never the master secret.
    if (!params.get('r') || !params.get('pk')) return { ok: false, room, error: 'missing-key' };
    const read = decode(params.get('r'), 32, 32);
    const publicKey = decode(params.get('pk'), 32, 32);
    if (!read || !publicKey) return { ok: false, room, error: 'invalid-key' };
    return {
      ok: true,
      ...common,
      protocol: 2,
      credentials: { protocol: 2, read, publicKey },
      secretB64: '',
      readB64: toBase64Url(read),
      publicKeyB64: toBase64Url(publicKey),
      viewOnly: true,
    };
  }
  if (!k) return { ok: false, room, error: 'missing-key' };
  const secret = decode(k, 16);
  if (!secret) return { ok: false, room, error: 'invalid-key' };
  return {
    ok: true,
    ...common,
    protocol,
    credentials: protocol === 2 ? { protocol: 2, master: secret } : { protocol: 1, secret },
    secretB64: toBase64Url(secret),
    // An edit link of a signed room grants editing; `v=1` on a protocol 1 link is a UI hint only.
    viewOnly: protocol === 2 ? false : params.get('v') === '1',
  };
}
