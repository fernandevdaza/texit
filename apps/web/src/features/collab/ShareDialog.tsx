import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  HardDrive,
  KeyRound,
  Lock,
  LogOut,
  Network,
  Pause,
  Pencil,
  Play,
  QrCode as QrIcon,
  RefreshCw,
  Share2,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { executeCommand } from '@/services/commands';
import { useSettings } from '@/state/settings';
import { useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { Avatar, Badge, Button, confirmDialog, Dialog, DropdownMenu, Segmented, toast, Tooltip } from '@/ui';
import { QrCode } from '@/ui/QrCode';
import {
  inviteLink,
  isPaused,
  leaveSession,
  openShareDialog,
  reconnectNow,
  setPaused,
  startSharing,
  stopSharing,
  useCollab,
  type CollabPeerView,
} from './session';
import { strategyInfo, useCollabSettings } from './settings';
import { StatusDot, statusLabel } from './StatusItem';
import { toggleFollow } from './follow';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function copyInviteLink(viewOnly = false) {
  const link = inviteLink(viewOnly);
  if (!link) return;
  if (await copyText(link)) toast.success(viewOnly ? 'View-only invite link copied' : 'Invite link copied', { description: 'Anyone with this link can decrypt the project — share it privately.' });
  else toast.error('Could not copy the link');
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-4">{icon}</span>
      <div>
        <div className="text-[13px] font-medium text-fg">{title}</div>
        <div className="text-[12px] leading-relaxed text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

function IntroView() {
  const strategy = useCollabSettings((s) => s.strategy);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 pb-1">
      <ul className="space-y-3.5">
        <Feature icon={<Network />} title="Peer-to-peer">
          Edits flow directly between browsers over WebRTC. There is no TexIt server and no account.
        </Feature>
        <Feature icon={<Lock />} title="End-to-end encrypted">
          Everything is encrypted (AES-256-GCM) with a key that only exists inside the invite link.
        </Feature>
        <Feature icon={<HardDrive />} title="Local-first">
          Your copy always stays on this device. Changes sync whenever at least one collaborator who has the project is online.
        </Feature>
      </ul>
      <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-fg-muted ring-1 ring-border">
        <span>
          Peers find each other through public <b className="font-medium text-fg">{strategyInfo[strategy].label}</b>; only encrypted connection offers pass
          through them.{' '}
          <button className="font-medium text-accent hover:underline" onClick={() => executeCommand('app.settings', 'collab')}>
            Change
          </button>
        </span>
      </div>
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<Share2 />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await startSharing();
            } catch (err) {
              toast.error('Could not start sharing', { description: String((err as Error)?.message ?? err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Start sharing
        </Button>
      </div>
    </div>
  );
}

function InviteSection() {
  const record = useCollab((s) => s.record)!;
  const [mode, setMode] = useState<'edit' | 'view'>(record.viewOnly ? 'view' : 'edit');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewOnly = mode === 'view' || record.viewOnly;
  const link = inviteLink(viewOnly) ?? '';
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-fg">Invite link</h3>
        {!record.viewOnly && (
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'edit', label: 'Can edit', icon: <Pencil /> },
              { value: 'view', label: 'View only', icon: <Eye /> },
            ]}
          />
        )}
      </div>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-2.5 font-mono text-[11.5px] text-fg-muted outline-none focus:border-accent"
          aria-label="Invite link"
        />
        <Button
          variant="primary"
          icon={copied ? <Check /> : <Copy />}
          onClick={async () => {
            if (await copyText(link)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Tooltip content={showQr ? 'Hide QR code' : 'Show QR code'}>
          <Button variant="secondary" aria-label="QR code" icon={<QrIcon />} className={cn('px-2', showQr && 'bg-active')} onClick={() => setShowQr((v) => !v)} />
        </Tooltip>
      </div>
      {showQr && (
        <div className="flex animate-fade-in items-center gap-3 rounded-lg bg-surface-2 p-3 ring-1 ring-border">
          <QrCode value={link} size={132} />
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">Scan to open the invite on another device. The QR code contains the decryption key — don't show it on a shared screen.</p>
        </div>
      )}
      {viewOnly ? (
        <p className="flex gap-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          <span>
            <b className="font-semibold">View-only is best-effort.</b> Peer-to-peer can't enforce permissions: the link still carries the decryption key and TexIt
            simply opens it read-only. Share it only with people you trust.
          </span>
        </p>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">Anyone with this link can open, decrypt and edit the project. Send it privately.</p>
      )}
    </section>
  );
}

function PeerRow({ p, you, file, following }: { p: Pick<CollabPeerView, 'name' | 'color' | 'role' | 'viewOnly' | 'rtt' | 'direct'> & { clientId?: number }; you?: boolean; file?: string; following?: boolean }) {
  const role = p.viewOnly ? 'Viewer' : p.role === 'owner' ? 'Owner' : 'Editor';
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <Avatar name={p.name} color={p.color} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg">
          <span className="truncate">{p.name}</span>
          {you && <span className="font-normal text-fg-subtle">(you)</span>}
          <Badge tone={p.viewOnly ? 'neutral' : p.role === 'owner' ? 'accent' : 'info'}>{role}</Badge>
        </div>
        <div className="truncate text-[11.5px] text-fg-subtle">
          {you ? 'This device' : file ? `In ${file}` : 'Browsing the project'}
          {!you && p.rtt != null && ` · ${p.rtt} ms`}
          {!you && !p.direct && ' · relayed via a peer'}
        </div>
      </div>
      {!you && p.clientId != null && (
        <Button size="xs" variant={following ? 'subtle' : 'ghost'} onClick={() => toggleFollow(p.clientId!)}>
          {following ? 'Following' : 'Follow'}
        </Button>
      )}
    </li>
  );
}

function PeopleSection() {
  const { peers, connectedPeers, record, following } = useCollab(
    useShallow((s) => ({ peers: s.peers, connectedPeers: s.connectedPeers, record: s.record!, following: s.following })),
  );
  const { userName, userColor } = useSettings(useShallow((s) => ({ userName: s.userName, userColor: s.userColor })));
  const files = useWorkspace((s) => s.files);
  const pending = Math.max(0, connectedPeers - peers.filter((p) => p.direct).length);
  return (
    <section>
      <h3 className="mb-1 text-[12px] font-semibold text-fg">People {peers.length > 0 && <span className="font-normal text-fg-subtle">· {peers.length + 1} online</span>}</h3>
      <ul className="divide-y divide-border">
        <PeerRow you p={{ name: userName, color: userColor, role: record.role, viewOnly: record.viewOnly, direct: true }} />
        {peers.map((p) => (
          <PeerRow key={p.clientId} p={p} file={files.find((f) => f.id === p.fileId)?.path} following={following === p.clientId} />
        ))}
      </ul>
      {pending > 0 && <p className="mt-1 text-[11.5px] text-fg-subtle">{pending} more connecting…</p>}
      {peers.length === 0 && pending === 0 && (
        <p className="mt-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-center text-[12px] text-fg-subtle">
          Nobody else is here yet. Send the invite link — collaborators appear as soon as they open it.
        </p>
      )}
    </section>
  );
}

function StatusSection() {
  const { status, record, signaling, peers, connectedPeers, fingerprint, error } = useCollab(
    useShallow((s) => ({
      status: s.status,
      record: s.record!,
      signaling: s.signaling,
      peers: s.peers.length,
      connectedPeers: s.connectedPeers,
      fingerprint: s.fingerprint,
      error: s.error,
    })),
  );
  const info = strategyInfo[record.strategy];
  const others = Math.max(peers, connectedPeers);
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-border">
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <StatusDot status={status} />
        {status === 'live' ? `Live · ${others} collaborator${others === 1 ? '' : 's'} online` : statusLabel(status, others, info.short)}
        <div className="flex-1" />
        {(status === 'connecting' || status === 'waiting' || status === 'offline') && (
          <Tooltip content="Leave and rejoin the room now">
            <button className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg" onClick={() => void reconnectNow()} aria-label="Reconnect">
              <RefreshCw className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-subtle">
        <span>
          {info.label}: {signaling.connected}/{signaling.total || '…'} reachable
        </span>
        {fingerprint && (
          <Tooltip content="Key fingerprint — collaborators with the same link see the same code">
            <span className="inline-flex items-center gap-1 font-mono">
              <KeyRound className="size-3" /> {fingerprint}
            </span>
          </Tooltip>
        )}
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3" /> End-to-end encrypted
        </span>
      </div>
      {error && <div className="mt-1.5 text-[11.5px] text-danger">{error}</div>}
    </div>
  );
}

function SharedFooter() {
  const { record, status } = useCollab(useShallow((s) => ({ record: s.record!, status: s.status })));
  const paused = status === 'paused' || isPaused();
  const owner = record.role === 'owner';
  return (
    <>
      <Button variant="ghost" icon={paused ? <Play /> : <Pause />} onClick={() => void setPaused(!paused)}>
        {paused ? 'Resume syncing' : 'Pause syncing'}
      </Button>
      <div className="flex-1" />
      {owner ? (
        <DropdownMenu
          align="end"
          side="top"
          trigger={
            <Button variant="secondary" iconRight={<ChevronDown />}>
              Stop sharing
            </Button>
          }
          items={[
            {
              label: 'Stop sharing',
              icon: <LogOut />,
              danger: true,
              onSelect: async () => {
                const ok = await confirmDialog({
                  title: 'Stop sharing this project?',
                  message: 'You will disconnect from all collaborators. They keep their copies, but changes no longer sync with yours.',
                  confirmLabel: 'Stop sharing',
                  danger: true,
                });
                if (ok) {
                  await stopSharing();
                  toast.success('Sharing stopped');
                }
              },
            },
            {
              label: 'Rotate key & re-share',
              icon: <RefreshCw />,
              onSelect: async () => {
                const ok = await confirmDialog({
                  title: 'Rotate the room key?',
                  message: 'A new room and key are generated. All existing invite links stop working and current collaborators are disconnected — send them the new link.',
                  confirmLabel: 'Rotate key',
                });
                if (ok) {
                  await stopSharing({ rotate: true });
                  toast.success('New invite link ready', { description: 'Old links no longer work.' });
                }
              },
            },
          ]}
        />
      ) : (
        <Button
          variant="secondary"
          icon={<LogOut />}
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Leave this shared project?',
              message: 'Your local copy stays on this device but will no longer sync with collaborators.',
              confirmLabel: 'Leave',
              danger: true,
            });
            if (ok) await leaveSession();
          }}
        >
          Leave session
        </Button>
      )}
    </>
  );
}

/** The share dialog (opened from the top-bar button, the status bar or `collab.share`). */
export function ShareDialog() {
  const open = useCollab((s) => s.shareOpen);
  const shared = useCollab((s) => !!s.record);
  const name = useWorkspace((s) => s.meta?.name ?? 'project');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => openShareDialog(o)}
      icon={<Users />}
      title={`Share “${name}”`}
      description={shared ? 'Real-time, peer-to-peer collaboration.' : 'Collaborate in real time — without any server.'}
      width="max-w-[520px]"
      footer={shared ? <SharedFooter /> : undefined}
    >
      {shared ? (
        <div className="space-y-4 pb-1">
          <StatusSection />
          <InviteSection />
          <PeopleSection />
        </div>
      ) : (
        <IntroView />
      )}
    </Dialog>
  );
}
