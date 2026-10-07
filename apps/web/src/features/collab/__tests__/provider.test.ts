import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { TrysteroProvider, type TrysteroProviderOptions } from '../provider';
import { generateSecret } from '../crypto';
import { FakeHub, sleep, waitFor } from './fakeTransport';

const ROOM = 'room-test-1';
const live: TrysteroProvider[] = [];

function peer(hub: FakeHub, id: string, secret: Uint8Array, extra: Partial<TrysteroProviderOptions> = {}, doc = new Y.Doc()) {
  const p = new TrysteroProvider(doc, {
    roomId: ROOM,
    secret,
    transport: hub.factory(id),
    batchMs: 0,
    resyncIntervalMs: 0,
    pingIntervalMs: 0,
    stallRejoinMs: 0,
    ...extra,
  });
  live.push(p);
  return p;
}

const text = (p: TrysteroProvider, name = 'main') => p.doc.getText(name).toString();

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.destroy()));
});

describe('TrysteroProvider sync protocol', () => {
  it('syncs initial state both ways (step 1 / step 2) and reports synced', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    a.doc.getText('main').insert(0, 'hello from A');
    a.doc.getMap('meta').set('name', 'Paper');
    const bDoc = new Y.Doc();
    bDoc.getText('other').insert(0, 'B only');
    const b = peer(hub, 'B', secret, {}, bDoc);

    await b.whenSynced(3000);
    await waitFor(() => a.synced, 3000, 'A synced');
    expect(text(b)).toBe('hello from A');
    expect(b.doc.getMap('meta').get('name')).toBe('Paper');
    expect(text(a, 'other')).toBe('B only');
    expect(a.status).toBe('connected');
    expect(b.peers.map((p) => p.id)).toEqual(['A']);
    await waitFor(() => b.peers[0]?.clientId === a.doc.clientID, 2000, 'hello');
  });

  it('propagates incremental edits and converges on concurrent edits', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const b = peer(hub, 'B', secret);
    await Promise.all([a.whenSynced(3000), b.whenSynced(3000)]);

    a.doc.getText('main').insert(0, 'abc');
    await waitFor(() => text(b) === 'abc', 2000, 'B receives');
    b.doc.getText('main').insert(3, 'def');
    await waitFor(() => text(a) === 'abcdef', 2000, 'A receives');

    // Concurrent edits at the same position.
    a.doc.getText('main').insert(0, 'X');
    b.doc.getText('main').insert(0, 'Y');
    await waitFor(() => text(a) === text(b) && text(a).length === 8, 2000, 'convergence');
    expect(text(a)).toMatch(/^(XY|YX)abcdef$/);
  });

  it('coalesces bursts of local updates into few messages', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret, { batchMs: 20 });
    const b = peer(hub, 'B', secret);
    await Promise.all([a.whenSynced(3000), b.whenSynced(3000)]);
    const before = hub.framesSent;
    const t = a.doc.getText('main');
    for (let i = 0; i < 200; i++) t.insert(t.length, 'x');
    await waitFor(() => text(b).length === 200, 2000);
    expect(hub.framesSent - before).toBeLessThan(10);
  });

  it('chunks large binary updates under the transport frame limit', async () => {
    const hub = new FakeHub();
    hub.maxFrameBytes = 1200;
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const blob = new Uint8Array(300_000);
    for (let i = 0; i < blob.length; i++) blob[i] = (i * 7919) & 0xff;
    a.doc.getMap<Uint8Array>('blobs').set('img', blob);
    const b = peer(hub, 'B', secret);
    const progress: number[] = [];
    b.on('progress', (p) => p && progress.push(p.received));
    await b.whenSynced(5000);
    const got = b.doc.getMap<Uint8Array>('blobs').get('img')!;
    expect(got.length).toBe(blob.length);
    expect(Buffer.from(got).equals(Buffer.from(blob))).toBe(true);
    expect(hub.largestFrame).toBeLessThanOrEqual(1200);
    expect(progress.length).toBeGreaterThan(10);

    // Live update of another big blob while connected.
    const blob2 = blob.map((x) => x ^ 0x5a);
    a.doc.getMap<Uint8Array>('blobs').set('img2', blob2);
    await waitFor(() => !!b.doc.getMap<Uint8Array>('blobs').get('img2'), 5000, 'img2');
    expect(Buffer.from(b.doc.getMap<Uint8Array>('blobs').get('img2')!).equals(Buffer.from(blob2))).toBe(true);
  });

  it('end-to-end encrypts: a peer with the wrong secret learns nothing and changes nothing', async () => {
    const hub = new FakeHub();
    hub.checkPassword = false; // pretend signaling let the intruder in
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    a.doc.getText('main').insert(0, 'top secret');
    const errors: string[] = [];
    const evil = peer(hub, 'E', generateSecret());
    evil.doc.getText('main').insert(0, 'injected');
    a.on('error', (e) => errors.push(e));
    evil.on('error', (e) => errors.push(e));
    await waitFor(() => errors.length >= 2, 3000, 'decrypt errors');
    await sleep(50);
    expect(text(evil)).toBe('injected');
    expect(text(a)).toBe('top secret');
    expect(evil.synced).toBe(false);
  });

  it('signaling password mismatch keeps peers apart', async () => {
    const hub = new FakeHub();
    const a = peer(hub, 'A', generateSecret());
    const b = peer(hub, 'B', generateSecret());
    await sleep(80);
    expect(a.peers).toHaveLength(0);
    expect(b.peers).toHaveLength(0);
  });

  it('re-broadcasts across a partial mesh (A–B–C without an A–C link)', async () => {
    const hub = new FakeHub();
    hub.canLink = (x, y) => !((x === 'A' && y === 'C') || (x === 'C' && y === 'A'));
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const b = peer(hub, 'B', secret);
    const c = peer(hub, 'C', secret);
    await Promise.all([a.whenSynced(3000), c.whenSynced(3000)]);
    a.doc.getText('main').insert(0, 'from A');
    await waitFor(() => text(c) === 'from A', 2000, 'C gets A via B');
    c.doc.getText('main').insert(0, 'C+');
    await waitFor(() => text(a) === 'C+from A', 2000, 'A gets C via B');
    expect(text(b)).toBe('C+from A');
    // Awareness also reaches across the mesh.
    a.awareness.setLocalStateField('user', { name: 'Ada' });
    await waitFor(() => c.awareness.getStates().get(a.doc.clientID)?.user?.name === 'Ada', 2000, 'awareness via B');
  });

  it('does not double-send in a full mesh (no forwarding to direct neighbours)', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const b = peer(hub, 'B', secret);
    const c = peer(hub, 'C', secret);
    await Promise.all([a.whenSynced(3000), b.whenSynced(3000), c.whenSynced(3000)]);
    await waitFor(() => [a, b, c].every((p) => p.peers.every((q) => q.neighbors.size === 2)), 2000, 'neighbour lists');
    const before = hub.framesSent;
    a.doc.getText('main').insert(0, 'z');
    await waitFor(() => text(b) === 'z' && text(c) === 'z', 2000);
    await sleep(30);
    expect(hub.framesSent - before).toBe(1); // one broadcast send, no re-broadcast
  });

  it('shares awareness and removes it when a peer disconnects or crashes', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const bAw = new Awareness(new Y.Doc());
    const b = peer(hub, 'B', secret, { awareness: undefined });
    const c = peer(hub, 'C', secret);
    a.awareness.setLocalStateField('user', { name: 'Ada', color: '#f00' });
    b.awareness.setLocalStateField('user', { name: 'Bob', color: '#0f0' });
    c.awareness.setLocalStateField('user', { name: 'Cy', color: '#00f' });
    await waitFor(() => a.awareness.getStates().size === 3, 3000, 'A sees 3');
    await waitFor(() => b.awareness.getStates().get(a.doc.clientID)?.user?.name === 'Ada', 2000, 'B sees Ada');

    await b.disconnect(); // graceful: awareness null + BYE
    await waitFor(() => !a.awareness.getStates().has(b.doc.clientID), 2000, 'B removed from A');
    expect(b.status).toBe('disconnected');
    expect(b.awareness.getStates().size).toBe(1); // only itself

    hub.kill('C'); // crash: transport leave event only
    await waitFor(() => !a.awareness.getStates().has(c.doc.clientID), 2000, 'C removed from A');
    expect(a.peers).toHaveLength(0);
    expect(a.status).toBe('connecting');
    bAw.destroy();
  });

  it('resyncs on (re)join: offline edits on both sides merge', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret);
    const b = peer(hub, 'B', secret);
    a.doc.getText('main').insert(0, 'base');
    await waitFor(() => text(b) === 'base', 3000);

    await b.disconnect();
    a.doc.getText('main').insert(4, ' A-offline');
    b.doc.getText('main').insert(0, 'B-offline ');
    await sleep(20);
    expect(text(a)).toBe('base A-offline');

    await b.connect();
    await waitFor(() => text(a) === text(b) && text(a).includes('B-offline') && text(a).includes('A-offline'), 3000, 'merge');
    expect(text(a)).toBe('B-offline base A-offline');
  });

  it('repairs lost messages with the periodic anti-entropy round', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    const a = peer(hub, 'A', secret, { resyncIntervalMs: 100 });
    const b = peer(hub, 'B', secret, { resyncIntervalMs: 100 });
    await Promise.all([a.whenSynced(3000), b.whenSynced(3000)]);
    let dropping = true;
    hub.drop = (from) => dropping && from === 'A';
    a.doc.getText('main').insert(0, 'lost?');
    await sleep(30);
    expect(text(b)).toBe('');
    dropping = false;
    await waitFor(() => text(b) === 'lost?', 3000, 'anti-entropy');
  });

  it('reconnects with backoff when joining fails', async () => {
    const hub = new FakeHub();
    const secret = generateSecret();
    let attempts = 0;
    const base = hub.factory('A');
    const flaky: TrysteroProviderOptions['transport'] = async (room, h) => {
      attempts++;
      if (attempts < 3) throw new Error('relay down');
      return base(room, h);
    };
    const errors: string[] = [];
    const a = peer(hub, 'A', secret, { transport: flaky, reconnect: { minMs: 10, maxMs: 40 } });
    a.on('error', (e) => errors.push(e));
    const b = peer(hub, 'B', secret);
    await waitFor(() => a.status === 'connected' && b.status === 'connected', 3000, 'eventual connection');
    expect(attempts).toBe(3);
    expect(errors.length).toBe(2);
  });
});
