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
  ShieldCheck,
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
import { isSignedRoom } from './rooms';
import { StatusDot, statusLabel } from './StatusItem';
import { toggleFollow } from './follow';
import { t as tr, useT } from '@/lib/i18n';
import { collabErrorText, richText, strategyInline, strategyLabel } from './i18n';

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
  if (await copyText(link)) toast.success(viewOnly ? tr('collab.viewOnlyLinkCopied') : tr('collab.inviteLinkCopied'), { description: tr('collab.linkCopiedHint') });
  else toast.error(tr('collab.copyFailed'));
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
  const t = useT();
  const strategy = useCollabSettings((s) => s.strategy);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 pb-1">
      <ul className="space-y-3.5">
        <Feature icon={<Network />} title={t('collab.p2pTitle')}>
          {t('collab.p2pBody')}
        </Feature>
        <Feature icon={<Lock />} title={t('collab.e2eTitle')}>
          {t('collab.e2eBody')}
        </Feature>
        <Feature icon={<HardDrive />} title={t('collab.localFirstTitle')}>
          {t('collab.localFirstBody')}
        </Feature>
      </ul>
      <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-fg-muted ring-1 ring-border">
        <span>
          {richText(t('collab.signalingNote'), { network: <b className="font-medium text-fg">{strategyInline(t, strategy)}</b> })}{' '}
          <button className="font-medium text-accent hover:underline" onClick={() => executeCommand('app.settings', 'collab')}>
            {t('collab.change')}
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
              toast.error(t('collab.couldNotStart'), { description: String((err as Error)?.message ?? err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('collab.startSharing')}
        </Button>
      </div>
    </div>
  );
}

function InviteSection() {
  const t = useT();
  const record = useCollab((s) => s.record)!;
  const [mode, setMode] = useState<'edit' | 'view'>(record.viewOnly ? 'view' : 'edit');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewOnly = mode === 'view' || record.viewOnly;
  const signed = isSignedRoom(record);
  const link = inviteLink(viewOnly) ?? '';
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-fg">{t('collab.inviteLink')}</h3>
        {!record.viewOnly && (
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'edit', label: t('collab.canEdit'), icon: <Pencil /> },
              { value: 'view', label: t('collab.viewOnly'), icon: <Eye /> },
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
          aria-label={t('collab.inviteLink')}
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
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Tooltip content={showQr ? t('collab.hideQr') : t('collab.showQr')}>
          <Button variant="secondary" aria-label={t('collab.qrCode')} icon={<QrIcon />} className={cn('px-2', showQr && 'bg-active')} onClick={() => setShowQr((v) => !v)} />
        </Tooltip>
      </div>
      {showQr && (
        <div className="flex animate-fade-in items-center gap-3 rounded-lg bg-surface-2 p-3 ring-1 ring-border">
          <QrCode value={link} size={132} />
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">{t('collab.qrHint')}</p>
        </div>
      )}
      {viewOnly && signed ? (
        <p className="flex gap-1.5 rounded-lg bg-success-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-success">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          <span>
            <b className="font-semibold">{t('collab.viewOnlySignedTitle')}</b> {t('collab.viewOnlySignedBody')}
          </span>
        </p>
      ) : viewOnly ? (
        <div className="space-y-1.5 rounded-lg bg-warning-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
          <p className="flex gap-1.5">
            <ShieldAlert className="mt-px size-3.5 shrink-0" />
            <span>
              <b className="font-semibold">{t('collab.legacyRoomTitle')}</b> {t('collab.legacyRoomBody')}
            </span>
          </p>
          {record.role === 'owner' && (
            <Button size="xs" variant="secondary" onClick={() => void stopSharing({ rotate: true })}>
              {t('collab.legacyRotate')}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">{t('collab.editLinkHint')}</p>
      )}
    </section>
  );
}

function PeerRow({ p, you, file, following }: { p: Pick<CollabPeerView, 'name' | 'color' | 'role' | 'viewOnly' | 'rtt' | 'direct'> & { clientId?: number }; you?: boolean; file?: string; following?: boolean }) {
  const t = useT();
  const role = p.viewOnly ? t('collab.roleViewer') : p.role === 'owner' ? t('collab.roleOwner') : t('collab.roleEditor');
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <Avatar name={p.name} color={p.color} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg">
          <span className="truncate">{p.name}</span>
          {you && <span className="font-normal text-fg-subtle">{t('collab.you')}</span>}
          <Badge tone={p.viewOnly ? 'neutral' : p.role === 'owner' ? 'accent' : 'info'}>{role}</Badge>
        </div>
        <div className="truncate text-[11.5px] text-fg-subtle">
          {you ? t('collab.thisDevice') : file ? t('collab.inFile', { file }) : t('collab.browsing')}
          {!you && p.rtt != null && ` · ${p.rtt} ms`}
          {!you && !p.direct && ` · ${t('collab.relayed')}`}
        </div>
      </div>
      {!you && p.clientId != null && (
        <Button size="xs" variant={following ? 'subtle' : 'ghost'} onClick={() => toggleFollow(p.clientId!)}>
          {following ? t('collab.following') : t('collab.follow')}
        </Button>
      )}
    </li>
  );
}

function PeopleSection() {
  const t = useT();
  const { peers, connectedPeers, record, following } = useCollab(
    useShallow((s) => ({ peers: s.peers, connectedPeers: s.connectedPeers, record: s.record!, following: s.following })),
  );
  const { userName, userColor } = useSettings(useShallow((s) => ({ userName: s.userName, userColor: s.userColor })));
  const files = useWorkspace((s) => s.files);
  const pending = Math.max(0, connectedPeers - peers.filter((p) => p.direct).length);
  return (
    <section>
      <h3 className="mb-1 text-[12px] font-semibold text-fg">{t('collab.people')} {peers.length > 0 && <span className="font-normal text-fg-subtle">· {t('collab.online', { count: peers.length + 1 })}</span>}</h3>
      <ul className="divide-y divide-border">
        <PeerRow you p={{ name: userName, color: userColor, role: record.role, viewOnly: record.viewOnly, direct: true }} />
        {peers.map((p) => (
          <PeerRow key={p.clientId} p={p} file={files.find((f) => f.id === p.fileId)?.path} following={following === p.clientId} />
        ))}
      </ul>
      {pending > 0 && <p className="mt-1 text-[11.5px] text-fg-subtle">{t('collab.moreConnecting', { count: pending })}</p>}
      {peers.length === 0 && pending === 0 && (
        <p className="mt-1 rounded-lg border border-dashed border-border px-3 py-2.5 text-center text-[12px] text-fg-subtle">
          {t('collab.nobodyYet')}
        </p>
      )}
    </section>
  );
}

function StatusSection() {
  const t = useT();
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
        {status === 'live' ? t('collab.liveOnline', { count: others }) : statusLabel(t, status, others, info.short)}
        <div className="flex-1" />
        {(status === 'connecting' || status === 'waiting' || status === 'offline') && (
          <Tooltip content={t('collab.rejoinTooltip')}>
            <button className="rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg" onClick={() => void reconnectNow()} aria-label={t('collab.reconnect')}>
              <RefreshCw className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-fg-subtle">
        <span>
          {t('collab.reachable', { network: strategyLabel(t, record.strategy), connected: signaling.connected, total: signaling.total || '…' })}
        </span>
        {fingerprint && (
          <Tooltip content={t('collab.fingerprintTooltip')}>
            <span className="inline-flex items-center gap-1 font-mono">
              <KeyRound className="size-3" /> {fingerprint}
            </span>
          </Tooltip>
        )}
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3" /> {t('collab.e2eTitle')}
        </span>
      </div>
      {error && <div className="mt-1.5 text-[11.5px] text-danger">{collabErrorText(t, error)}</div>}
    </div>
  );
}

function SharedFooter() {
  const t = useT();
  const { record, status } = useCollab(useShallow((s) => ({ record: s.record!, status: s.status })));
  const paused = status === 'paused' || isPaused();
  const owner = record.role === 'owner';
  return (
    <>
      <Button variant="ghost" icon={paused ? <Play /> : <Pause />} onClick={() => void setPaused(!paused)}>
        {paused ? t('collab.resumeSync') : t('collab.pauseSync')}
      </Button>
      <div className="flex-1" />
      {owner ? (
        <DropdownMenu
          align="end"
          side="top"
          trigger={
            <Button variant="secondary" iconRight={<ChevronDown />}>
              {t('collab.stopSharing')}
            </Button>
          }
          items={[
            {
              label: t('collab.stopSharing'),
              icon: <LogOut />,
              danger: true,
              onSelect: async () => {
                const ok = await confirmDialog({
                  title: t('collab.stopSharingTitle'),
                  message: t('collab.stopSharingMessage'),
                  confirmLabel: t('collab.stopSharing'),
                  danger: true,
                });
                if (ok) {
                  await stopSharing();
                  toast.success(t('collab.sharingStopped'));
                }
              },
            },
            {
              label: t('collab.rotateKey'),
              icon: <RefreshCw />,
              onSelect: async () => {
                const ok = await confirmDialog({
                  title: t('collab.rotateTitle'),
                  message: t('collab.rotateMessage'),
                  confirmLabel: t('collab.rotateConfirm'),
                });
                if (ok) {
                  await stopSharing({ rotate: true });
                  toast.success(t('collab.newLinkReady'), { description: t('collab.oldLinksDead') });
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
              title: t('collab.leaveTitle'),
              message: t('collab.leaveMessage'),
              confirmLabel: t('collab.leave'),
              danger: true,
            });
            if (ok) await leaveSession();
          }}
        >
          {t('collab.leaveSession')}
        </Button>
      )}
    </>
  );
}

/** The share dialog (opened from the top-bar button, the status bar or `collab.share`). */
export function ShareDialog() {
  const t = useT();
  const open = useCollab((s) => s.shareOpen);
  const shared = useCollab((s) => !!s.record);
  const name = useWorkspace((s) => s.meta?.name) ?? t('collab.projectFallback');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => openShareDialog(o)}
      icon={<Users />}
      title={t('collab.shareTitle', { name })}
      description={shared ? t('collab.sharedDescription') : t('collab.introDescription')}
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
