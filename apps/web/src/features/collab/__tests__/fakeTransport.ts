/**
 * In-memory transport hub for protocol tests. Models a WebRTC mesh: every
 * pair of peers that `canLink` allows gets a bidirectional link; frames are
 * delivered asynchronously, can be size-limited, dropped or inspected.
 */
import type { Transport, TransportFactory, TransportHandlers } from '../transport';

interface Node {
  id: string;
  handlers: TransportHandlers;
  links: Set<string>;
  password: string;
}

export class FakeHub {
  nodes = new Map<string, Node>();
  /** Largest frame accepted (throws above, like a data channel would). */
  maxFrameBytes = 1024;
  /** Decide which peer pairs can connect (default: full mesh). */
  canLink: (a: string, b: string) => boolean = () => true;
  /** Simulate Trystero's signaling password check. */
  checkPassword = true;
  /** Drop frames for which this returns true. */
  drop: (from: string, to: string, frame: Uint8Array) => boolean = () => false;
  framesSent = 0;
  largestFrame = 0;
  bytesSent = 0;

  factory(id: string): TransportFactory {
    return async (room, handlers) => {
      if (this.nodes.has(id)) throw new Error(`peer ${id} already joined`);
      const node: Node = { id, handlers, links: new Set(), password: room.password };
      this.nodes.set(id, node);
      // Connect to existing peers asynchronously (like ICE).
      setTimeout(() => {
        if (this.nodes.get(id) !== node) return;
        for (const other of this.nodes.values()) {
          if (other === node || !this.canLink(id, other.id)) continue;
          if (this.checkPassword && other.password !== node.password) continue;
          if (node.links.has(other.id)) continue;
          node.links.add(other.id);
          other.links.add(id);
          other.handlers.onPeerJoin(id);
          node.handlers.onPeerJoin(other.id);
        }
      }, 1);
      const t: Transport = {
        selfId: id,
        maxFrameBytes: this.maxFrameBytes,
        send: async (frame, target) => {
          if (this.nodes.get(id) !== node) return;
          if (frame.length > this.maxFrameBytes) throw new Error(`frame too large: ${frame.length}`);
          this.framesSent++;
          this.bytesSent += frame.length;
          this.largestFrame = Math.max(this.largestFrame, frame.length);
          const targets = target == null ? Array.from(node.links) : Array.isArray(target) ? target : [target];
          for (const to of targets) {
            if (!node.links.has(to)) continue;
            if (this.drop(id, to, frame)) continue;
            const copy = frame.slice();
            setTimeout(() => {
              const dest = this.nodes.get(to);
              if (dest && dest.links.has(id)) dest.handlers.onMessage(copy, id);
            }, 0);
          }
        },
        peers: () => Array.from(node.links),
        leave: async () => this.remove(id, node),
      };
      return t;
    };
  }

  /** Abruptly cut a peer (as if its tab crashed). */
  kill(id: string) {
    const n = this.nodes.get(id);
    if (n) this.remove(id, n);
  }

  private remove(id: string, node: Node) {
    if (this.nodes.get(id) !== node) return;
    this.nodes.delete(id);
    for (const other of node.links) {
      const o = this.nodes.get(other);
      if (!o) continue;
      o.links.delete(id);
      setTimeout(() => o.handlers.onPeerLeave(id), 0);
    }
    node.links.clear();
  }
}

export async function waitFor(cond: () => boolean, timeoutMs = 4000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
