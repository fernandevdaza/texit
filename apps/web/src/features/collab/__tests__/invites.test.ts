import { describe, expect, it } from 'vitest';
import { buildInviteLink, credentialsOf, parseInvite, type RoomRecord } from '../rooms';
import { deriveShareSecrets, generateSecret, toBase64Url } from '../crypto';

const BASE = 'https://texit.test/app/';
const ROOM = 'AbCdEf123456';

function parse(link: string) {
  const hash = link.slice(link.indexOf('#'));
  const route = hash.replace(/^#\/join\//, '');
  return parseInvite(route, hash, '');
}

describe('invite links', () => {
  it('signed rooms: the view link carries the read secret + public key, never the master secret', async () => {
    const master = generateSecret();
    const { read, publicKey } = await deriveShareSecrets(master, ROOM);
    const common = { room: ROOM, name: 'Tesis', strategy: 'nostr' as const, protocol: 2 as const, secret: toBase64Url(master), read: toBase64Url(read), publicKey: toBase64Url(publicKey) };
    const view = buildInviteLink({ ...common, viewOnly: true }, BASE);
    const edit = buildInviteLink({ ...common, viewOnly: false }, BASE);
    expect(view).not.toContain(toBase64Url(master));
    expect(view).not.toMatch(/[?&]k=/);
    expect(edit).toContain(`k=${toBase64Url(master)}`);

    const pv = parse(view);
    expect(pv.ok && pv.viewOnly && pv.protocol === 2 && pv.credentials.protocol === 2 && !('master' in pv.credentials)).toBe(true);
    const pe = parse(edit);
    expect(pe.ok && !pe.viewOnly && pe.protocol === 2 && 'master' in pe.credentials).toBe(true);
  });

  it('a view link of a signed room cannot be turned into an edit link by removing v=1', async () => {
    const master = generateSecret();
    const { read, publicKey } = await deriveShareSecrets(master, ROOM);
    const view = buildInviteLink({ room: ROOM, name: 'x', strategy: 'nostr', protocol: 2, viewOnly: true, read: toBase64Url(read), publicKey: toBase64Url(publicKey) }, BASE);
    const p = parse(view.replace('&v=1', ''));
    expect(p.ok && p.viewOnly && !('master' in p.credentials)).toBe(true);
  });

  it('legacy links still parse (protocol 1)', () => {
    const secret = toBase64Url(generateSecret());
    const p = parse(buildInviteLink({ room: ROOM, name: 'x', strategy: 'nostr', secret }, BASE));
    expect(p.ok && p.protocol === 1 && p.credentials.protocol === 1).toBe(true);
  });

  it('records map to the right credentials', () => {
    const base: RoomRecord = { projectId: 'p', room: ROOM, secret: toBase64Url(generateSecret()), role: 'owner', viewOnly: false, strategy: 'nostr', createdAt: 0 };
    expect(credentialsOf(base).protocol).toBe(1);
    expect('master' in credentialsOf({ ...base, protocol: 2, read: 'x', publicKey: 'y' })).toBe(true);
    const reader = credentialsOf({ ...base, protocol: 2, secret: '', viewOnly: true, read: toBase64Url(generateSecret()), publicKey: toBase64Url(generateSecret()) });
    expect('read' in reader).toBe(true);
  });
});
