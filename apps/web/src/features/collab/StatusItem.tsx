import { useShallow } from 'zustand/react/shallow';
import { Eye } from 'lucide-react';
import { StatusButton } from '@/features/workspace/StatusBar';
import { cn } from '@/lib/cn';
import { openShareDialog, useCollab, type CollabUiStatus } from './session';
import { strategyInfo } from './settings';
import { useT, type TFunction } from '@/lib/i18n';
import './i18n';

export function StatusDot({ status, className }: { status: CollabUiStatus; className?: string }) {
  const color =
    status === 'live'
      ? 'bg-success'
      : status === 'waiting'
        ? 'bg-success/70'
        : status === 'connecting'
          ? 'bg-warning'
          : 'bg-fg-subtle/60';
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {(status === 'live' || status === 'connecting') && (
        <span className={cn('absolute inline-flex size-full rounded-full opacity-60', color, status === 'live' ? 'animate-ping' : 'animate-pulse')} />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

export function statusLabel(t: TFunction, status: CollabUiStatus, others: number, strategy?: string): string {
  switch (status) {
    case 'live':
      return t('collab.statusLive', { count: others });
    case 'waiting':
      return t('collab.statusWaiting');
    case 'connecting':
      return strategy ? t('collab.statusConnectingTo', { network: strategy }) : t('collab.statusConnecting');
    case 'offline':
      return t('collab.statusOffline');
    case 'paused':
      return t('collab.statusPaused');
    default:
      return t('collab.statusOff');
  }
}

/** Status-bar item: offline / connecting / "Live · N" with a pulsing dot. */
export function CollabStatusItem() {
  const t = useT();
  const { status, peers, connectedPeers, record, signaling } = useCollab(
    useShallow((s) => ({ status: s.status, peers: s.peers.length, connectedPeers: s.connectedPeers, record: s.record, signaling: s.signaling })),
  );
  if (status === 'off' || !record) return null;
  const others = Math.max(peers, connectedPeers);
  const strategy = strategyInfo[record.strategy]?.short;
  const title =
    status === 'live'
      ? t('collab.titleLive', { count: others })
      : status === 'waiting'
        ? t('collab.titleWaiting', { count: signaling.connected, network: strategy })
        : status === 'connecting'
          ? t('collab.titleConnecting', { network: strategy })
          : status === 'paused'
            ? t('collab.titlePaused')
            : t('collab.titleOffline');
  return (
    <StatusButton onClick={() => openShareDialog()} title={title} className={cn(status === 'live' && 'text-fg-muted')}>
      <StatusDot status={status} className="mr-0.5" />
      {statusLabel(t, status, others, strategy)}
      {record.viewOnly && (
        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-surface-2 px-1 text-[10px] ring-1 ring-border">
          <Eye /> {t('collab.viewOnlyBadge')}
        </span>
      )}
    </StatusButton>
  );
}
