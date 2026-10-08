import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TrysteroProvider, type TrysteroProviderOptions } from '../provider';
import { deriveKeysFor, deriveShareSecrets, generateSecret, setEd25519Backend, signMessage, verifyMessage, type RoomCredentials } from '../crypto';
import { FakeHub, sleep, waitFor } from './fakeTransport';

const ROOM = 'room-signed-1';
const live: TrysteroProvider[] = [];

function peer(hub: FakeHub, id: string, credentials: RoomCredentials, extra: Partial<TrysteroProviderOptions> = {}) {
  const p = new TrysteroProvider(new Y.Doc(), {
    roomId: ROOM,
    credentials,
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

async function roomCredentials() {
  const master = generateSecret();
  const { read, publicKey } = await deriveShareSecrets(master, ROOM);
  return {
    editor: { protocol: 2, master } as RoomCredentials,
    reader: { protocol: 2, read, publicKey } as RoomCredentials,
  };
}

const text = (p: TrysteroProvider) => p.doc.getText('main').toString();

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.destroy()));
});

describe('signed rooms (protocol 2)', () => {
  it('derives the same read key for editors and readers; only editors can sign', async () => {
    const { editor, reader } = await roomCredentials();
    const ke = await deriveKeysFor(editor, ROOM);
    const kr = await deriveKeysFor(reader, ROOM);
    expect(ke.fingerprint).toBe(kr.fingerprint);
    expect(ke.signalingPassword).toBe(kr.signalingPassword);
    expect(ke.canWrite).toBe(true);
    expect(kr.canWrite).toBe(false);
    const msg = new TextEncoder().encode('update');
    const sig = await signMessage(ke, msg);
    expect(await verifyMessage(kr, msg, sig)).toBe(true);
    expect(await verifyMessage(kr, new TextEncoder().encode('updatE'), sig)).toBe(false);
    await expect(signMessage(kr, msg)).rejects.toThrow();
  });

  it('readers receive the document and live edits', async () => {
    const hub = new FakeHub();
    const { editor, reader } = await roomCredentials();
    const e = peer(hub, 'E', editor, { role: 'owner' });
    e.doc.getText('main').insert(0, 'Hola');
    const r = peer(hub, 'R', reader, { role: 'guest', viewOnly: true });
    await r.whenSynced(3000);
    expect(text(r)).toBe('Hola');
    e.doc.getText('main').insert(4, ', mundo');
    await waitFor(() => text(r) === 'Hola, mundo', 2000, 'reader receives edits');
    expect(r.canWrite).toBe(false);
    expect(r.signed).toBe(true);
  });

  it("a reader's local edits never reach editors", async () => {
    const hub = new FakeHub();
    const { editor, reader } = await roomCredentials();
    const e = peer(hub, 'E', editor);
    e.doc.getText('main').insert(0, 'original');
    const r = peer(hub, 'R', reader, { viewOnly: true });
    await r.whenSynced(3000);
    r.doc.getText('main').insert(0, 'HACK ');
    r.resync();
    await sleep(150);
    expect(text(e)).toBe('original');
  });

  it('a modified reader client that sends unsigned changes is rejected', async () => {
    const hub = new FakeHub();
    const { editor, reader } = await roomCredentials();
    const e = peer(hub, 'E', editor);
    e.doc.getText('main').insert(0, 'original');
    const rejected: string[] = [];
    e.on('rejected', (x) => rejected.push(x.reason));
    const r = peer(hub, 'R', reader, { viewOnly: true });
    await r.whenSynced(3000);
    // Simulate a tampered client: pretend we can write so local changes are broadcast (unsigned).
    (r as unknown as { keys: { canWrite: boolean } }).keys.canWrite = true;
    r.doc.getText('main').insert(0, 'HACK ');
    await waitFor(() => rejected.length > 0, 2000, 'editor rejects');
    await sleep(100);
    expect(text(e)).toBe('original');
    expect(rejected).toContain('unsigned');
  });

  it('a reader with a forged key cannot sign valid changes', async () => {
    const hub = new FakeHub();
    const { editor, reader } = await roomCredentials();
    const e = peer(hub, 'E', editor);
    e.doc.getText('main').insert(0, 'original');
    const rejected: string[] = [];
    e.on('rejected', (x) => rejected.push(x.reason));
    const r = peer(hub, 'R', reader, { viewOnly: true });
    await r.whenSynced(3000);
    // Tampered client signs with a key of its own making (not the editors').
    const forged = await deriveKeysFor({ protocol: 2, master: generateSecret() }, ROOM);
    const k = (r as unknown as { keys: { canWrite: boolean; signKey: unknown } }).keys;
    k.canWrite = true;
    k.signKey = forged.signKey;
    r.doc.getText('main').insert(0, 'HACK ');
    await waitFor(() => rejected.length > 0, 2000, 'editor rejects forged signature');
    await sleep(100);
    expect(text(e)).toBe('original');
    expect(rejected).toContain('bad-signature');
  });

  it('readers forward signed updates across a partial mesh (E1 – R – E2)', async () => {
    const hub = new FakeHub();
    hub.canLink = (a, b) => !((a === 'E1' && b === 'E2') || (a === 'E2' && b === 'E1'));
    const { editor, reader } = await roomCredentials();
    const e1 = peer(hub, 'E1', editor);
    e1.doc.getText('main').insert(0, 'seed. ');
    const r = peer(hub, 'R', reader, { viewOnly: true });
    await r.whenSynced(3000);
    // E2 can only reach E1's existing content through the reader (signed messages replayed verbatim).
    const e2 = peer(hub, 'E2', editor);
    await e2.whenSynced(3000);
    expect(text(e2)).toBe('seed. ');
    e1.doc.getText('main').insert(6, 'from E1');
    await waitFor(() => text(r) === 'seed. from E1', 2000, 'reader receives');
    await waitFor(() => text(e2) === 'seed. from E1', 2000, 'E2 receives through the reader');
  });

  it('two editors still sync both ways', async () => {
    const hub = new FakeHub();
    const { editor } = await roomCredentials();
    const a = peer(hub, 'A', editor);
    const b = peer(hub, 'B', editor);
    await Promise.all([a.whenSynced(3000), b.whenSynced(3000)]);
    a.doc.getText('main').insert(0, 'abc');
    await waitFor(() => text(b) === 'abc', 2000, 'B receives');
    b.doc.getText('main').insert(3, 'def');
    await waitFor(() => text(a) === 'abcdef', 2000, 'A receives');
  });
});

describe('Ed25519 backends', () => {
  afterEach(() => setEd25519Backend('auto'));

  it('the pure-JS fallback derives the same public key and signatures as WebCrypto', async () => {
    const master = generateSecret();
    setEd25519Backend('native');
    const native = await deriveShareSecrets(master, ROOM);
    const kn = await deriveKeysFor({ protocol: 2, master }, ROOM);
    setEd25519Backend('js');
    const js = await deriveShareSecrets(master, ROOM);
    const kj = await deriveKeysFor({ protocol: 2, read: js.read, publicKey: js.publicKey }, ROOM);
    expect(Array.from(js.publicKey)).toEqual(Array.from(native.publicKey));
    const msg = new TextEncoder().encode('sync update');
    const sigNative = await signMessage(kn, msg);
    const sigJs = await signMessage(await deriveKeysFor({ protocol: 2, master }, ROOM), msg);
    expect(Array.from(sigJs)).toEqual(Array.from(sigNative));
    expect(await verifyMessage(kj, msg, sigNative)).toBe(true);
    expect(await verifyMessage(kj, new TextEncoder().encode('tampered'), sigNative)).toBe(false);
  });

  it('a JS-fallback reader syncs with a native editor', async () => {
    const hub = new FakeHub();
    const master = generateSecret();
    setEd25519Backend('native');
    const e = peer(hub, 'E', { protocol: 2, master });
    e.doc.getText('main').insert(0, 'desde escritorio');
    await sleep(20);
    setEd25519Backend('js');
    const { read, publicKey } = await deriveShareSecrets(master, ROOM);
    const r = peer(hub, 'R', { protocol: 2, read, publicKey }, { viewOnly: true });
    await r.whenSynced(3000);
    expect(text(r)).toBe('desde escritorio');
    e.doc.getText('main').insert(0, '¡');
    await waitFor(() => text(r) === '¡desde escritorio', 2000, 'live update verified with the JS fallback');
  });
});
