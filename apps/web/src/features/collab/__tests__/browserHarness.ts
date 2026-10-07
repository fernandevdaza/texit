/**
 * Dev-only harness for manual/automated browser checks of the real Trystero
 * transport (not imported by the app). In a dev tab:
 *   const h = await import('/src/features/collab/__tests__/browserHarness.ts')
 *   const peer = h.startPeer('room', secretB64, 'nostr')
 */
import * as Y from 'yjs';
import { TrysteroProvider } from '../provider';
import { trysteroTransport, type SignalingStrategy } from '../transport';
import { fromBase64Url, generateSecret, toBase64Url } from '../crypto';

export const newSecret = () => toBase64Url(generateSecret());

export function startPeer(room: string, secret: string, strategy: SignalingStrategy = 'nostr') {
  const doc = new Y.Doc();
  const log: string[] = [];
  const t0 = performance.now();
  const stamp = (m: string) => log.push(`${Math.round(performance.now() - t0)}ms ${m}`);
  const provider = new TrysteroProvider(doc, { roomId: room, secret: fromBase64Url(secret), transport: trysteroTransport({ strategy }) });
  provider.on('status', (s) => stamp(`status ${s}`));
  provider.on('signaling', (s) => stamp(`signaling ${s.connected}/${s.total}`));
  provider.on('peers', (p) => stamp(`peers ${p.length}`));
  provider.on('synced', () => stamp('synced'));
  provider.on('error', (e) => stamp(`error ${e}`));
  return { doc, provider, log, text: () => doc.getText('t').toString(), Y };
}
