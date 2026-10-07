import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { AlertTriangle, Check, Eye, KeyRound, Lock, RefreshCw } from 'lucide-react';
import { ProjectDoc } from '@texit/core';
import { createProject, getSummary } from '@/services/projects';
import { navigate } from '@/lib/router';
import { Button, EmptyState, Logo, Spinner } from '@/ui';
import { cn } from '@/lib/cn';
import type { TrysteroProvider } from './provider';
import type { SignalingState } from './transport';
import { createRoomProvider } from './session';
import { deleteRoomRecord, findRoomRecordByRoom, parseInvite, saveRoomRecord } from './rooms';
import { strategyInfo } from './settings';

const WAIT_TIMEOUT_MS = 45_000;

type Phase = 'checking' | 'signaling' | 'waiting' | 'receiving' | 'saving' | 'timeout' | 'error';

interface JoinState {
  phase: Phase;
  signaling: SignalingState;
  peers: number;
  progress: number | null;
  error?: string;
}

const errorText: Record<string, { title: string; description: string }> = {
  'missing-key': { title: 'This invite link is incomplete', description: 'The decryption key is missing. Ask for the full link — everything after the “#” matters.' },
  'invalid-key': { title: 'This invite link is damaged', description: 'The decryption key in the link is not valid. Ask your collaborator to copy the link again.' },
  'invalid-room': { title: 'This invite link is not valid', description: 'The room id in the link is malformed.' },
};

/** `#/join/:room?k=<secret>&n=<name>[&v=1][&s=<strategy>]` — joins a shared project. */
export function JoinRoute({ room }: { room: string }) {
  const invite = useMemo(() => parseInvite(room), [room]);
  const [attempt, setAttempt] = useState(0);
  const [st, setSt] = useState<JoinState>({ phase: 'checking', signaling: { connected: 0, total: 0, relays: [] }, peers: 0, progress: null });
  const providerRef = useRef<TrysteroProvider | null>(null);

  useEffect(() => {
    if (!invite.ok) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const doc = new Y.Doc();
    let provider: TrysteroProvider | null = null;
    const patch = (p: Partial<JoinState>) => !cancelled && setSt((s) => ({ ...s, ...p }));

    (async () => {
      // Already have this project locally? Just open it.
      const existing = await findRoomRecordByRoom(invite.room);
      if (cancelled) return;
      if (existing) {
        const summary = await getSummary(existing.projectId);
        if (summary && !summary.trashed) {
          // An edit link upgrades a previous view-only join.
          if (existing.viewOnly && !invite.viewOnly) await saveRoomRecord({ ...existing, viewOnly: false });
          if (!cancelled) navigate(`/p/${existing.projectId}`, { replace: true });
          return;
        }
        await deleteRoomRecord(existing.projectId);
      }
      if (cancelled) return;
      patch({ phase: 'signaling', peers: 0, progress: null, error: undefined });
      provider = createRoomProvider(doc, {
        room: invite.room,
        secret: invite.secret,
        strategy: invite.strategy,
        role: 'guest',
        viewOnly: invite.viewOnly,
      });
      providerRef.current = provider;
      const p = provider;
      const meta = doc.getMap('meta');

      const phaseFor = (): Phase => (p.peers.length ? 'waiting' : p.signaling.connected ? 'waiting' : 'signaling');
      p.on('signaling', (signaling) => patch({ signaling, phase: phaseFor() }));
      p.on('peers', (peers) => patch({ peers: peers.length, phase: phaseFor() }));
      p.on('progress', (pr) => patch(pr ? { phase: 'receiving', progress: pr.received / pr.total } : { progress: null }));
      p.on('error', (error) => patch({ error }));

      const armTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => patch({ phase: 'timeout' }), WAIT_TIMEOUT_MS);
      };
      armTimeout();

      let saving = false;
      const tryFinish = async () => {
        if (saving || cancelled || !p.synced || !meta.get('name')) return;
        saving = true;
        clearTimeout(timeout);
        patch({ phase: 'saving', progress: null });
        doc.off('update', onUpdate);
        // Leave the temporary room before the workspace joins it with the persisted doc.
        await p.destroy();
        if (cancelled) return;
        try {
          const name = String(meta.get('name') || invite.name);
          const id = await createProject({ name, doc: new ProjectDoc(doc), collab: { room: invite.room, role: 'guest' } });
          await saveRoomRecord({
            projectId: id,
            room: invite.room,
            secret: invite.secretB64,
            role: 'guest',
            viewOnly: invite.viewOnly,
            strategy: invite.strategy,
            createdAt: Date.now(),
          });
          if (!cancelled) navigate(`/p/${id}`, { replace: true });
        } catch (err) {
          patch({ phase: 'error', error: String((err as Error)?.message ?? err) });
        }
      };
      const onUpdate = () => void tryFinish();
      doc.on('update', onUpdate);
      p.on('synced', () => void tryFinish());
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      const p = provider;
      providerRef.current = null;
      void (async () => {
        await p?.destroy();
        doc.destroy();
      })();
    };
  }, [invite, attempt]);

  if (!invite.ok) {
    const e = errorText[invite.error];
    return (
      <Shell>
        <EmptyState
          icon={<AlertTriangle />}
          title={e.title}
          description={e.description}
          action={<Button onClick={() => navigate('/', { replace: true })}>Back to projects</Button>}
        />
      </Shell>
    );
  }

  const strat = strategyInfo[invite.strategy];
  const steps: { label: string; detail?: string; state: 'done' | 'active' | 'todo' }[] = [
    {
      label: `Reaching ${strat.label}`,
      detail: st.signaling.total ? `${st.signaling.connected}/${st.signaling.total} reachable` : undefined,
      state: st.signaling.connected > 0 || ['receiving', 'saving'].includes(st.phase) || st.peers > 0 ? 'done' : 'active',
    },
    {
      label: 'Waiting for someone who has this project to be online',
      detail: st.peers ? `${st.peers} peer${st.peers > 1 ? 's' : ''} connected` : undefined,
      state: st.peers > 0 || ['receiving', 'saving'].includes(st.phase) ? 'done' : st.signaling.connected > 0 ? 'active' : 'todo',
    },
    {
      label: 'Receiving the project (end-to-end encrypted)',
      detail: st.progress != null ? `${Math.round(st.progress * 100)}%` : undefined,
      state: st.phase === 'saving' ? 'done' : st.peers > 0 || st.phase === 'receiving' ? 'active' : 'todo',
    },
    { label: 'Saving a local copy on this device', state: st.phase === 'saving' ? 'active' : 'todo' },
  ];

  return (
    <Shell>
      <div className="w-full max-w-[440px] animate-scale-in rounded-2xl border border-border bg-elevated p-7 shadow-xl">
        <Radar active={st.phase !== 'timeout' && st.phase !== 'error'} />
        <div className="mt-5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">You're invited to</div>
          <h1 className="mt-1 truncate text-[19px] font-semibold tracking-tight text-fg">{invite.name}</h1>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-fg-subtle">
            <Lock className="size-3" /> Peer-to-peer · end-to-end encrypted
            {invite.viewOnly && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 ring-1 ring-border">
                <Eye className="size-3" /> View-only
              </span>
            )}
          </div>
        </div>

        {st.phase === 'timeout' ? (
          <div className="mt-6 rounded-xl bg-warning-soft p-3.5 text-[12.5px] leading-relaxed text-fg">
            <div className="font-semibold text-warning">Nobody with this project seems to be online</div>
            <p className="mt-1 text-fg-muted">
              TexIt has no server: someone who already has the project must have it open. Ask a collaborator to open it, then try again — we'll keep listening
              meanwhile.
            </p>
          </div>
        ) : st.phase === 'error' ? (
          <div className="mt-6 rounded-xl bg-danger-soft p-3.5 text-[12.5px] text-danger">{st.error ?? 'Something went wrong.'}</div>
        ) : (
          <ol className="mt-6 space-y-2.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    s.state === 'done' && 'bg-success text-white',
                    s.state === 'active' && 'bg-accent-soft text-accent',
                    s.state === 'todo' && 'bg-surface-2 text-fg-subtle ring-1 ring-border',
                  )}
                >
                  {s.state === 'done' ? <Check className="size-3" /> : s.state === 'active' ? <Spinner className="size-3" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-[12.5px]', s.state === 'todo' ? 'text-fg-subtle' : 'text-fg')}>{s.label}</div>
                  {s.detail && <div className="text-[11px] text-fg-subtle">{s.detail}</div>}
                  {i === 2 && st.progress != null && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(st.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {st.error && st.phase !== 'error' && <p className="mt-3 text-[11.5px] text-danger">{st.error}</p>}

        <div className="mt-6 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
            <KeyRound className="size-3" /> The key never leaves your browser
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/', { replace: true })} disabled={st.phase === 'saving'}>
              Cancel
            </Button>
            {(st.phase === 'timeout' || st.phase === 'error') && (
              <Button variant="primary" icon={<RefreshCw />} onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-bg px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--tx-accent-soft),transparent_60%)]" />
      <button onClick={() => navigate('/')} className="absolute left-4 top-4 flex items-center gap-2 text-[13px] font-semibold text-fg" aria-label="All projects">
        <Logo size={22} /> TexIt
      </button>
      <div className="relative flex w-full justify-center">{children}</div>
    </div>
  );
}

/** Animated "looking for peers" radar. */
function Radar({ active }: { active: boolean }) {
  return (
    <div className="relative mx-auto flex size-28 items-center justify-center">
      {active &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute inset-0 rounded-full border border-accent/40"
            style={{ animation: `tx-radar 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) ${i * 0.8}s infinite` }}
          />
        ))}
      <span className="absolute inset-6 rounded-full bg-accent-soft" />
      <span className="relative flex size-12 items-center justify-center rounded-2xl bg-elevated shadow-md ring-1 ring-border">
        <Logo size={28} />
      </span>
      {active && (
        <span className="absolute inset-0" style={{ animation: 'tx-orbit 3.2s linear infinite' }}>
          <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 rounded-full bg-success shadow-[0_0_0_3px_var(--tx-elevated)]" />
        </span>
      )}
      <style>{`
        @keyframes tx-radar { from { transform: scale(0.45); opacity: 1 } to { transform: scale(1.25); opacity: 0 } }
        @keyframes tx-orbit { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
