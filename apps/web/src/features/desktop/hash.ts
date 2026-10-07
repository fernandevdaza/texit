/**
 * Fast non-cryptographic content hashes used to recognise our own writes
 * (echo suppression) in the disk ↔ Y.Doc mirror. Text is hashed as decoded
 * characters so the same file hashes identically on both sides.
 */

function mix(h1: number, h2: number, len: number): string {
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}.${len.toString(36)}`;
}

export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return 't' + mix(h1, h2, s.length);
}

export function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ b.length;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return 'b' + mix(h1, h2, b.length);
}

export function hashContent(c: string | Uint8Array): string {
  return typeof c === 'string' ? hashString(c) : hashBytes(c);
}
