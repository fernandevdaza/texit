/**
 * End-to-end encryption for collaboration rooms (WebCrypto only, no deps).
 *
 * Every room has a 256-bit random secret that travels only inside the invite
 * link's URL fragment (never sent to any server). From it we derive, with
 * HKDF-SHA256 (salted with the room id, distinct `info` labels):
 *
 *   - an AES-GCM-256 key that encrypts every Yjs/awareness payload,
 *   - the Trystero signaling password (encrypts SDP offers on public relays),
 *   - a short fingerprint users can compare out-of-band.
 *
 * Low-entropy secrets (hand-typed passphrases, < 16 bytes) are first
 * stretched with PBKDF2 (600k iterations) before entering HKDF.
 *
 * Wire envelope: [version=1 : u8][iv : 12 bytes][ciphertext ‖ GCM tag]
 * The AAD binds the ciphertext to the protocol version and room id, so a
 * payload can't be replayed into another room even with the same key.
 */

const te = new TextEncoder();
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
export const SECRET_BYTES = 32;
const PBKDF2_ITERATIONS = 600_000;

type Bytes = Uint8Array<ArrayBuffer>;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available (a secure context — https or localhost — is required for collaboration).');
  return s;
}

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto's BufferSource typing). */
function bytes(u: Uint8Array): Bytes {
  return (u.buffer instanceof ArrayBuffer && u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u : new Uint8Array(u)) as Bytes;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** A fresh 256-bit room secret. */
export function generateSecret(): Uint8Array {
  return randomBytes(SECRET_BYTES);
}

/** A random, URL-safe room id (96 bits → 16 chars). */
export function generateRoomId(): string {
  return toBase64Url(randomBytes(12));
}

export function toBase64Url(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('Invalid base64url string');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface RoomKeys {
  roomId: string;
  /** AES-GCM-256 key for all payloads (non-extractable). */
  key: CryptoKey;
  /** Password handed to Trystero to encrypt signaling (SDP) on public relays. */
  signalingPassword: string;
  /** Short human-comparable fingerprint of the room key ("3FA2-91C0"). */
  fingerprint: string;
  /** Additional authenticated data for this room. */
  aad: Uint8Array;
}

async function hkdfBits(base: CryptoKey, salt: Uint8Array, info: string, bits: number): Promise<Uint8Array> {
  const out = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: te.encode(info) }, base, bits);
  return new Uint8Array(out);
}

/** Derive every key of a room from its secret. Never log the secret or the derived material. */
export async function deriveRoomKeys(secret: Uint8Array, roomId: string): Promise<RoomKeys> {
  if (!secret.length) throw new Error('Empty room secret');
  const s = subtle();
  let ikm: Uint8Array = secret;
  if (secret.length < 16) {
    // Low-entropy passphrase: stretch it first.
    const pb = await s.importKey('raw', bytes(secret), 'PBKDF2', false, ['deriveBits']);
    ikm = new Uint8Array(
      await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(`texit/collab/pbkdf2/${roomId}`), iterations: PBKDF2_ITERATIONS }, pb, 256),
    );
  }
  const base = await s.importKey('raw', bytes(ikm), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = te.encode(`texit/collab/v1/${roomId}`);
  const key = await s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('payload/aes-gcm-256') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const signaling = await hkdfBits(base, salt, 'signaling/password', 256);
  const fp = await hkdfBits(base, salt, 'fingerprint', 32);
  const hex = Array.from(fp, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  return {
    roomId,
    key,
    signalingPassword: toBase64Url(signaling),
    fingerprint: `${hex.slice(0, 4)}-${hex.slice(4, 8)}`,
    aad: te.encode(`texit/collab/v1|${roomId}`),
  };
}

export async function encrypt(keys: Pick<RoomKeys, 'key' | 'aad'>, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: bytes(keys.aad) }, keys.key, bytes(plaintext)),
  );
  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = ENVELOPE_VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return out;
}

export class DecryptError extends Error {
  constructor(message = 'Could not decrypt payload (wrong room key or corrupted data)') {
    super(message);
    this.name = 'DecryptError';
  }
}

export async function decrypt(keys: Pick<RoomKeys, 'key' | 'aad'>, envelope: Uint8Array): Promise<Uint8Array> {
  if (envelope.length < 1 + IV_BYTES + 16 || envelope[0] !== ENVELOPE_VERSION) throw new DecryptError('Malformed encrypted envelope');
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const ct = envelope.subarray(1 + IV_BYTES);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: bytes(keys.aad) }, keys.key, bytes(ct)));
  } catch {
    throw new DecryptError();
  }
}
