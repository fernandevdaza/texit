import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CheckCircle2, CircleSlash, Loader2, Plus, Radio, Trash2, Wifi } from 'lucide-react';
import { useSettings } from '@/state/settings';
import { Avatar, Button, Field, IconButton, Input, SettingRow, Switch, Textarea } from '@/ui';
import { cn } from '@/lib/cn';
import { strategyInfo, transportOptionsFor, useCollabSettings, type IceServerEntry } from './settings';
import { loadStrategy, type SignalingStrategy } from './transport';

const STRATEGIES: SignalingStrategy[] = ['nostr', 'torrent', 'mqtt'];
const SWATCHES = ['#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e'];

interface TestResult {
  label: string;
  ok: boolean | null;
  detail: string;
}

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function testRelay(url: string, strategy: SignalingStrategy, timeoutMs = 6000): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    let ws: WebSocket;
    const done = (ok: boolean, detail: string) => {
      clearTimeout(t);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ label: url.replace(/^wss?:\/\//, ''), ok, detail });
    };
    const t = setTimeout(() => done(false, 'timed out'), timeoutMs);
    try {
      ws = strategy === 'mqtt' ? new WebSocket(url.replace(/^wss:\/\/[^@/]*@/, 'wss://'), ['mqtt']) : new WebSocket(url);
      ws.onopen = () => done(true, `${Math.round(performance.now() - start)} ms`);
      ws.onerror = () => done(false, 'unreachable');
    } catch (err) {
      done(false, String((err as Error)?.message ?? err));
    }
  });
}

async function testIce(servers: RTCIceServer[]): Promise<TestResult[]> {
  const pc = new RTCPeerConnection({ iceServers: servers });
  const types = new Set<string>();
  pc.createDataChannel('probe');
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 6000);
    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        clearTimeout(t);
        resolve();
        return;
      }
      if (e.candidate.type) types.add(e.candidate.type);
    };
  });
  pc.close();
  const hasTurn = servers.some((s) => [s.urls].flat().some((u) => /^turns?:/.test(u)));
  const out: TestResult[] = [
    { label: 'Local network (host candidates)', ok: types.has('host'), detail: types.has('host') ? 'ok' : 'none' },
    { label: 'STUN — public address discovery', ok: types.has('srflx'), detail: types.has('srflx') ? 'ok' : 'no reflexive candidate (strict NAT/firewall?)' },
  ];
  if (hasTurn) out.push({ label: 'TURN relay', ok: types.has('relay'), detail: types.has('relay') ? 'ok' : 'no relay candidate — check credentials' });
  return out;
}

function ConnectivityTest({ strategy }: { strategy: SignalingStrategy }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [relayCount, setRelayCount] = useState(0);
  const run = async () => {
    setRunning(true);
    setResults(null);
    try {
      const opts = transportOptionsFor(strategy);
      const mod = await loadStrategy(strategy);
      const urls = (opts.relayUrls?.length ? opts.relayUrls : mod.defaultRelayUrls).slice(0, 8);
      const defaultsStun = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'].map((u) => ({ urls: u }));
      const ice: RTCIceServer[] = opts.iceServers ?? [...defaultsStun, ...((opts.turnServers ?? []) as RTCIceServer[])];
      const [relays, iceRes] = await Promise.all([Promise.all(urls.map((u) => testRelay(u, strategy))), testIce(ice).catch(() => [] as TestResult[])]);
      setRelayCount(relays.length);
      setResults([...relays, ...iceRes]);
    } finally {
      setRunning(false);
    }
  };
  const okRelays = results?.slice(0, relayCount).filter((r) => r.ok).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button variant="secondary" icon={running ? <Loader2 className="animate-spin" /> : <Wifi />} onClick={run} disabled={running}>
          {running ? 'Testing…' : 'Test connectivity'}
        </Button>
        {results && okRelays != null && (
          <span className={cn('text-[12px]', okRelays > 0 ? 'text-success' : 'text-danger')}>
            {okRelays > 0 ? `${okRelays} ${strategyInfo[strategy].short} relay${okRelays > 1 ? 's' : ''} reachable` : 'No relay reachable'}
          </span>
        )}
      </div>
      {results && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-[12px]">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
              {r.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <CircleSlash className="size-3.5 shrink-0 text-danger" />}
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{r.label}</span>
              <span className="shrink-0 text-fg-subtle">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IceServersEditor() {
  const { iceServers, replaceDefaultIce, set } = useCollabSettings(
    useShallow((s) => ({ iceServers: s.iceServers, replaceDefaultIce: s.replaceDefaultIce, set: s.set })),
  );
  const update = (i: number, patch: Partial<IceServerEntry>) => set({ iceServers: iceServers.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <div className="space-y-2">
      {iceServers.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_110px_110px_auto] items-center gap-1.5">
          <Input inputSize="sm" value={e.urls} placeholder="turn:turn.example.com:3478" onChange={(ev) => update(i, { urls: ev.target.value })} />
          <Input inputSize="sm" value={e.username ?? ''} placeholder="username" onChange={(ev) => update(i, { username: ev.target.value })} />
          <Input inputSize="sm" type="password" value={e.credential ?? ''} placeholder="credential" onChange={(ev) => update(i, { credential: ev.target.value })} />
          <IconButton label="Remove server" size="sm" onClick={() => set({ iceServers: iceServers.filter((_, j) => j !== i) })}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => set({ iceServers: [...iceServers, { urls: '' }] })}>
        Add STUN/TURN server
      </Button>
      {iceServers.length > 0 && (
        <SettingRow title="Use only these servers" description="Skip the default public STUN servers (Google, Cloudflare).">
          <Switch checked={replaceDefaultIce} onCheckedChange={(v) => set({ replaceDefaultIce: v })} />
        </SettingRow>
      )}
    </div>
  );
}

/** Collaboration section of the Settings dialog. */
export function CollabSettings() {
  const s = useCollabSettings();
  const { userName, userColor, set: setProfile } = useSettings(useShallow((x) => ({ userName: x.userName, userColor: x.userColor, set: x.set })));
  const [relayText, setRelayText] = useState<Record<string, string>>({});
  const strategy = s.strategy;
  const relayValue = relayText[strategy] ?? (s.relayUrls[strategy] ?? []).join('\n');
  const badRelays = relayValue
    .split(/\s+/)
    .filter(Boolean)
    .filter((u) => !/^wss?:\/\//.test(u));

  return (
    <div className="space-y-7">
      <Section title="Your presence" description="How collaborators see you — your name labels your cursor, chat messages and comments.">
        <div className="flex items-center gap-3">
          <Avatar name={userName || '?'} color={userColor} size={34} />
          <Input value={userName} onChange={(e) => setProfile({ userName: e.target.value })} placeholder="Display name" className="max-w-[240px]" />
          <div className="flex flex-wrap gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => setProfile({ userColor: c })}
                className={cn('size-5 rounded-full transition-transform hover:scale-110', userColor === c && 'ring-2 ring-fg/60 ring-offset-2 ring-offset-elevated')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Signaling network"
        description="Peers discover each other through public relays; only encrypted connection offers (no project data) pass through them. Used when you start sharing — invite links carry the network, so guests join the same one automatically."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {STRATEGIES.map((id) => (
            <button
              key={id}
              onClick={() => s.set({ strategy: id })}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                strategy === id ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/15' : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                <Radio className={cn('size-3.5', strategy === id ? 'text-accent' : 'text-fg-subtle')} />
                {strategyInfo[id].label}
              </div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">{strategyInfo[id].description}</div>
            </button>
          ))}
        </div>
        <Field
          label={`Custom ${strategyInfo[strategy].short} relays`}
          hint="optional, one wss:// URL per line"
          description="Leave empty to use the public defaults. Every collaborator must use the same relays to find each other."
        >
          <Textarea
            value={relayValue}
            rows={3}
            spellCheck={false}
            className="font-mono text-[11.5px]"
            placeholder={strategy === 'nostr' ? 'wss://relay.example.com' : strategy === 'mqtt' ? 'wss://broker.example.com:8084/mqtt' : 'wss://tracker.example.com'}
            onChange={(e) => setRelayText((r) => ({ ...r, [strategy]: e.target.value }))}
            onBlur={() => {
              const urls = relayValue.split(/\s+/).filter((u) => /^wss?:\/\//.test(u));
              s.setRelayUrls(strategy, urls);
              setRelayText((r) => ({ ...r, [strategy]: urls.join('\n') }));
            }}
          />
          {badRelays.length > 0 && <p className="text-[11.5px] text-danger">Ignored (must start with wss://): {badRelays.join(', ')}</p>}
        </Field>
      </Section>

      <Section
        title="STUN / TURN servers"
        description="WebRTC needs STUN to traverse most NATs. On strict corporate or mobile networks add a TURN server (e.g. Cloudflare, Metered, coturn) — data relayed through it stays end-to-end encrypted."
      >
        <IceServersEditor />
      </Section>

      <Section title="Diagnostics" description="Checks that the signaling relays of the selected network and your STUN/TURN servers are reachable from this device.">
        <ConnectivityTest strategy={strategy} />
      </Section>

      <Section title="Invites & notifications">
        <Field
          label="Invite link base URL"
          hint="optional"
          description="Where invite links point to. Useful in the desktop app: set it to the public web app so anyone can open your links."
        >
          <Input value={s.inviteBaseUrl} placeholder={`${location.origin}${location.pathname}`} onChange={(e) => s.set({ inviteBaseUrl: e.target.value })} />
        </Field>
        <SettingRow title="Chat notifications" description="Show a toast for new chat messages while the chat panel is hidden.">
          <Switch checked={s.chatToasts} onCheckedChange={(v) => s.set({ chatToasts: v })} />
        </SettingRow>
      </Section>
    </div>
  );
}
