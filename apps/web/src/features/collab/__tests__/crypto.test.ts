import { describe, expect, it } from 'vitest';
import { decrypt, deriveRoomKeys, encrypt, fromBase64Url, generateSecret, toBase64Url } from '../crypto';
import { frameMessage, Reassembler } from '../framing';

describe('crypto', () => {
  it('round-trips base64url', () => {
    const s = generateSecret();
    const enc = toBase64Url(s);
    expect(enc).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Array.from(fromBase64Url(enc))).toEqual(Array.from(s));
    expect(() => fromBase64Url('not base64!')).toThrow();
  });

  it('encrypts with AES-GCM bound to the room', async () => {
    const secret = generateSecret();
    const k1 = await deriveRoomKeys(secret, 'room-a');
    const k1b = await deriveRoomKeys(secret, 'room-a');
    const k2 = await deriveRoomKeys(secret, 'room-b');
    const msg = new TextEncoder().encode('\\documentclass{article}');
    const env = await encrypt(k1, msg);
    expect(new TextDecoder().decode(await decrypt(k1b, env))).toBe('\\documentclass{article}');
    // Same plaintext → different ciphertext (random IV).
    expect(toBase64Url(await encrypt(k1, msg))).not.toBe(toBase64Url(env));
    // Other room (same secret) can't decrypt; tampering is detected.
    await expect(decrypt(k2, env)).rejects.toThrow();
    const tampered = env.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(decrypt(k1, tampered)).rejects.toThrow();
    expect(k1.fingerprint).toBe(k1b.fingerprint);
    expect(k1.fingerprint).not.toBe(k2.fingerprint);
    expect(k1.signalingPassword).not.toBe(toBase64Url(secret));
  });

  it('stretches short passphrases', async () => {
    const pass = new TextEncoder().encode('hunter2');
    const k = await deriveRoomKeys(pass, 'r');
    const env = await encrypt(k, new Uint8Array([1, 2, 3]));
    expect(Array.from(await decrypt(await deriveRoomKeys(pass, 'r'), env))).toEqual([1, 2, 3]);
  }, 20_000);
});

describe('framing', () => {
  it('passes small messages in one frame', () => {
    const frames = frameMessage(new Uint8Array([1, 2, 3]), 100, 7);
    expect(frames).toHaveLength(1);
    expect(Array.from(new Reassembler().push('p', frames[0])!)).toEqual([1, 2, 3]);
  });

  it('chunks and reassembles out of order, per peer', () => {
    const data = new Uint8Array(10_000).map((_, i) => i % 251);
    const frames = frameMessage(data, 512, 42);
    expect(frames.length).toBeGreaterThan(19);
    expect(frames.every((f) => f.length <= 512)).toBe(true);
    const r = new Reassembler();
    const shuffled = [...frames].reverse();
    let out: Uint8Array | null = null;
    for (const f of shuffled) {
      expect(out).toBeNull();
      out = r.push('peer-1', f);
      r.push('peer-2', frames[0]); // another peer's partial message must not interfere
    }
    expect(Array.from(out!)).toEqual(Array.from(data));
    expect(r.inFlight().map((p) => p.peerId)).toEqual(['peer-2']);
    r.clearPeer('peer-2');
    expect(r.inFlight()).toHaveLength(0);
  });

  it('rejects oversize and malformed frames', () => {
    const r = new Reassembler({ maxMessageBytes: 1000 });
    const frames = frameMessage(new Uint8Array(5000), 600, 1);
    expect(() => frames.forEach((f) => r.push('p', f))).toThrow(/size limit/);
    expect(() => r.push('p', new Uint8Array([9, 9, 9]))).toThrow();
  });

  it('garbage-collects stale partial messages', () => {
    const r = new Reassembler({ timeoutMs: 1000 });
    const frames = frameMessage(new Uint8Array(3000), 600, 1);
    r.push('p', frames[0], 0);
    r.gc(500);
    expect(r.inFlight()).toHaveLength(1);
    r.gc(2000);
    expect(r.inFlight()).toHaveLength(0);
  });
});
