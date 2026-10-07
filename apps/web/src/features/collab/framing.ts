/**
 * Transport framing: splits (already encrypted) messages into frames that fit
 * under the transport's message-size limit and reassembles them on receipt.
 *
 * WebRTC data channels reject / fragment messages above ~16–256 KiB depending
 * on the browser, and Trystero inlines a payload in a single frame only below
 * 16 KiB (bigger payloads cost an offer/accept round-trip). Doing our own
 * chunking keeps every frame a cheap single send, lets small keystroke updates
 * interleave with a large image transfer, and gives us receive progress.
 *
 *   single: [0x01][payload…]
 *   chunk : [0x02][msgId : u32][index : u32][count : u32][payload…]
 *
 * Integrity is provided by the AES-GCM tag of the reassembled envelope.
 */

export const FRAME_SINGLE = 1;
export const FRAME_CHUNK = 2;
export const CHUNK_HEADER_BYTES = 13;

export function frameMessage(payload: Uint8Array, maxFrameBytes: number, msgId: number): Uint8Array[] {
  if (maxFrameBytes <= CHUNK_HEADER_BYTES + 1) throw new Error('maxFrameBytes too small');
  if (payload.length + 1 <= maxFrameBytes) {
    const out = new Uint8Array(payload.length + 1);
    out[0] = FRAME_SINGLE;
    out.set(payload, 1);
    return [out];
  }
  const per = maxFrameBytes - CHUNK_HEADER_BYTES;
  const count = Math.ceil(payload.length / per);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = payload.subarray(i * per, Math.min(payload.length, (i + 1) * per));
    const f = new Uint8Array(CHUNK_HEADER_BYTES + part.length);
    const v = new DataView(f.buffer);
    f[0] = FRAME_CHUNK;
    v.setUint32(1, msgId >>> 0);
    v.setUint32(5, i);
    v.setUint32(9, count);
    f.set(part, CHUNK_HEADER_BYTES);
    frames.push(f);
  }
  return frames;
}

interface Partial {
  parts: (Uint8Array | undefined)[];
  received: number;
  bytes: number;
  lastSeen: number;
}

export interface ReassemblyProgress {
  peerId: string;
  msgId: number;
  received: number;
  total: number;
  bytes: number;
}

export interface ReassemblerOptions {
  /** Reject messages larger than this (default 512 MiB). */
  maxMessageBytes?: number;
  /** Drop incomplete messages not touched for this long (default 2 min). */
  timeoutMs?: number;
  /** Called while multi-frame messages arrive. */
  onProgress?: (p: ReassemblyProgress) => void;
}

export class Reassembler {
  private pending = new Map<string, Partial>();
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly onProgress?: (p: ReassemblyProgress) => void;

  constructor(opts: ReassemblerOptions = {}) {
    this.maxBytes = opts.maxMessageBytes ?? 512 * 1024 * 1024;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.onProgress = opts.onProgress;
  }

  /** Feed one frame; returns the complete payload once all of its frames arrived. Throws on malformed frames. */
  push(peerId: string, frame: Uint8Array, now = Date.now()): Uint8Array | null {
    if (frame.length < 1) throw new Error('Empty frame');
    if (frame[0] === FRAME_SINGLE) return frame.subarray(1);
    if (frame[0] !== FRAME_CHUNK || frame.length < CHUNK_HEADER_BYTES) throw new Error('Unknown frame type');
    const v = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const msgId = v.getUint32(1);
    const index = v.getUint32(5);
    const count = v.getUint32(9);
    if (count < 1 || index >= count || count > 1 << 20) throw new Error('Bad chunk header');
    const key = `${peerId}\u0000${msgId}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { parts: new Array(count), received: 0, bytes: 0, lastSeen: now };
      this.pending.set(key, p);
    } else if (p.parts.length !== count) {
      // Id reuse (sender restarted): start over.
      p = { parts: new Array(count), received: 0, bytes: 0, lastSeen: now };
      this.pending.set(key, p);
    }
    p.lastSeen = now;
    if (!p.parts[index]) {
      const data = frame.slice(CHUNK_HEADER_BYTES);
      p.parts[index] = data;
      p.received++;
      p.bytes += data.length;
      if (p.bytes > this.maxBytes) {
        this.pending.delete(key);
        throw new Error('Incoming message exceeds the size limit');
      }
    }
    this.onProgress?.({ peerId, msgId, received: p.received, total: count, bytes: p.bytes });
    if (p.received < count) return null;
    this.pending.delete(key);
    const out = new Uint8Array(p.bytes);
    let off = 0;
    for (const part of p.parts) {
      out.set(part!, off);
      off += part!.length;
    }
    return out;
  }

  clearPeer(peerId: string) {
    const prefix = `${peerId}\u0000`;
    for (const k of Array.from(this.pending.keys())) if (k.startsWith(prefix)) this.pending.delete(k);
  }

  /** Drop stale partial messages. */
  gc(now = Date.now()) {
    for (const [k, p] of this.pending) if (now - p.lastSeen > this.timeoutMs) this.pending.delete(k);
  }

  /** In-flight multi-frame messages (for progress UIs). */
  inFlight(): ReassemblyProgress[] {
    const out: ReassemblyProgress[] = [];
    for (const [k, p] of this.pending) {
      const [peerId, id] = k.split('\u0000');
      out.push({ peerId, msgId: Number(id), received: p.received, total: p.parts.length, bytes: p.bytes });
    }
    return out;
  }

  clear() {
    this.pending.clear();
  }
}
