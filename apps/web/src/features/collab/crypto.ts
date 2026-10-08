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
 *
 * Protocol 2 — enforced read-only access (signed rooms):
 *
 *   master (editors only, 256 bit)
 *     ├─ HKDF "read-secret"          → read secret  (everyone: editors + readers)
 *     │     └─ HKDF …                 → AES key, signaling password, fingerprint
 *     └─ HKDF "sign/ed25519-seed"     → Ed25519 key pair (private: editors; public: everyone)
 *
 * Edit links carry the master secret; view links carry only the read secret and
 * the public key. Every message that changes the document is signed with the
 * editors' private key, and peers drop document changes without a valid
 * signature — so a reader can decrypt and follow along but cannot inject edits,
 * even with a modified client.
 */

import * as ed from '@noble/ed25519';

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

/** What a participant holds for a room. */
export type RoomCredentials =
  /** Legacy rooms: one shared secret, no signatures (view-only enforced by the UI only). */
  | { protocol: 1; secret: Uint8Array }
  /** Signed room, editor: the master secret (derives everything). */
  | { protocol: 2; master: Uint8Array }
  /** Signed room, reader: read secret + the editors' public key (cannot sign). */
  | { protocol: 2; read: Uint8Array; publicKey: Uint8Array };

/** Ed25519 signing with the editors' private key (native WebCrypto or the pure-JS fallback). */
export interface Ed25519Signer {
  sign(data: Uint8Array): Promise<Uint8Array>;
}
/** Ed25519 verification against the editors' public key. */
export interface Ed25519Verifier {
  verify(data: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export interface RoomKeys {
  roomId: string;
  protocol: 1 | 2;
  /** Editors' private signing key (protocol 2 editors only). */
  signKey: Ed25519Signer | null;
  /** Editors' public key (protocol 2). */
  verifyKey: Ed25519Verifier | null;
  /** May this participant change the document (and have peers accept it)? */
  canWrite: boolean;
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

// ───────────────────────────── Ed25519 ─────────────────────────────
//
// WebCrypto Ed25519 is missing in some browsers (e.g. Brave / older Chromium on
// Android, older Safari). Ed25519 is deterministic, so the pure-JS
// implementation (@noble/ed25519, audited) produces byte-identical keys and
// signatures: native and fallback peers interoperate in the same room.

let ed25519Backend: 'auto' | 'native' | 'js' = 'auto';
let nativeSupport: Promise<boolean> | null = null;

/** Test hook: force a backend. */
export function setEd25519Backend(b: 'auto' | 'native' | 'js') {
  ed25519Backend = b;
}

function hasNativeEd25519(): Promise<boolean> {
  if (ed25519Backend !== 'auto') return Promise.resolve(ed25519Backend === 'native');
  nativeSupport ??= (async () => {
    try {
      const pub = await ed.getPublicKeyAsync(new Uint8Array(32).fill(7));
      await subtle().importKey('raw', bytes(pub), { name: 'Ed25519' }, false, ['verify']);
      return true;
    } catch {
      return false;
    }
  })();
  return nativeSupport;
}

async function ed25519FromSeed(seed: Uint8Array): Promise<{ publicKey: Uint8Array; signer: Ed25519Signer }> {
  if (await hasNativeEd25519()) {
    const s = subtle();
    const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
    pkcs8.set(ED25519_PKCS8_PREFIX);
    pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);
    // Extractable only to read the public half (JWK "x").
    const key = await s.importKey('pkcs8', bytes(pkcs8), { name: 'Ed25519' }, true, ['sign']);
    pkcs8.fill(0);
    const jwk = await s.exportKey('jwk', key);
    return {
      publicKey: fromBase64Url(jwk.x!),
      signer: { sign: async (data) => new Uint8Array(await s.sign({ name: 'Ed25519' }, key, bytes(data))) },
    };
  }
  const secret = new Uint8Array(seed);
  return {
    publicKey: await ed.getPublicKeyAsync(secret),
    signer: { sign: (data) => ed.signAsync(data, secret) },
  };
}

async function ed25519Verifier(publicKey: Uint8Array): Promise<Ed25519Verifier> {
  if (publicKey.length !== 32) throw new Error('Invalid room public key');
  if (await hasNativeEd25519()) {
    const s = subtle();
    const key = await s.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return { verify: (data, sig) => s.verify({ name: 'Ed25519' }, key, bytes(sig), bytes(data)) };
  }
  const pub = new Uint8Array(publicKey);
  // zip215: false → strict RFC 8032 verification, the same rules as WebCrypto.
  return { verify: (data, sig) => ed.verifyAsync(sig, data, pub, { zip215: false }) };
}

const ED25519_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

async function stretch(secret: Uint8Array, roomId: string): Promise<Uint8Array> {
  if (secret.length >= 16) return secret;
  // Low-entropy passphrase: stretch it first.
  const s = subtle();
  const pb = await s.importKey('raw', bytes(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(`texit/collab/pbkdf2/${roomId}`), iterations: PBKDF2_ITERATIONS }, pb, 256),
  );
}

/** AES key, signaling password and fingerprint from a (read) secret. */
async function payloadKeys(secret: Uint8Array, roomId: string, version: 1 | 2) {
  const s = subtle();
  const base = await s.importKey('raw', bytes(await stretch(secret, roomId)), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = te.encode(`texit/collab/v${version}/${roomId}`);
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
    key,
    signalingPassword: toBase64Url(signaling),
    fingerprint: `${hex.slice(0, 4)}-${hex.slice(4, 8)}`,
    aad: te.encode(`texit/collab/v${version}|${roomId}`),
  };
}

/** Derive every key of a legacy (protocol 1) room from its secret. Never log the secret or the derived material. */
export async function deriveRoomKeys(secret: Uint8Array, roomId: string): Promise<RoomKeys> {
  if (!secret.length) throw new Error('Empty room secret');
  return { roomId, protocol: 1, signKey: null, verifyKey: null, canWrite: true, ...(await payloadKeys(secret, roomId, 1)) };
}

/** Read secret + Ed25519 key pair of a signed room, from its master secret. */
export async function deriveShareSecrets(master: Uint8Array, roomId: string): Promise<{ read: Uint8Array; publicKey: Uint8Array; signKey: Ed25519Signer }> {
  if (master.length < 16) throw new Error('The master secret of a signed room must be at least 128 bits');
  const base = await subtle().importKey('raw', bytes(master), 'HKDF', false, ['deriveBits']);
  const salt = te.encode(`texit/collab/v2/${roomId}`);
  const read = await hkdfBits(base, salt, 'read-secret', 256);
  const seed = await hkdfBits(base, salt, 'sign/ed25519-seed', 256);
  const { publicKey, signer } = await ed25519FromSeed(seed);
  seed.fill(0);
  return { read, publicKey, signKey: signer };
}

/** Derive the keys for any kind of credentials. */
export async function deriveKeysFor(creds: RoomCredentials, roomId: string): Promise<RoomKeys> {
  if (creds.protocol === 1) return deriveRoomKeys(creds.secret, roomId);
  if ('master' in creds) {
    const { read, publicKey, signKey } = await deriveShareSecrets(creds.master, roomId);
    return { roomId, protocol: 2, signKey, verifyKey: await ed25519Verifier(publicKey), canWrite: true, ...(await payloadKeys(read, roomId, 2)) };
  }
  return { roomId, protocol: 2, signKey: null, verifyKey: await ed25519Verifier(creds.publicKey), canWrite: false, ...(await payloadKeys(creds.read, roomId, 2)) };
}

function signingInput(keys: Pick<RoomKeys, 'roomId'>, message: Uint8Array): Uint8Array {
  const prefix = te.encode(`texit/collab/v2/sign|${keys.roomId}|`);
  const out = new Uint8Array(prefix.length + message.length);
  out.set(prefix);
  out.set(message, prefix.length);
  return out;
}

/** Ed25519 signature of a protocol message (editors only). */
export async function signMessage(keys: Pick<RoomKeys, 'roomId' | 'signKey'>, message: Uint8Array): Promise<Uint8Array> {
  if (!keys.signKey) throw new Error('This participant cannot sign (read-only)');
  return keys.signKey.sign(signingInput(keys, message));
}

export async function verifyMessage(keys: Pick<RoomKeys, 'roomId' | 'verifyKey'>, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (!keys.verifyKey || signature.length !== 64) return false;
  try {
    return await keys.verifyKey.verify(signingInput(keys, message), signature);
  } catch {
    return false;
  }
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
