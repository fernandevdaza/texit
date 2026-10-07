import { useShallow } from 'zustand/react/shallow';
import { Eye } from 'lucide-react';
import { StatusButton } from '@/features/workspace/StatusBar';
import { cn } from '@/lib/cn';
import { openShareDialog, useCollab, type CollabUiStatus } from './session';
import { strategyInfo } from './settings';

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

export function statusLabel(status: CollabUiStatus, others: number, strategy?: string): string {
  switch (status) {
    case 'live':
      return `Live · ${others}`;
    case 'waiting':
      return 'Shared · waiting for peers';
    case 'connecting':
      return strategy ? `Connecting to ${strategy}…` : 'Connecting…';
    case 'offline':
      return 'Offline';
    case 'paused':
      return 'Paused';
    default:
      return 'Not shared';
  }
}

/** Status-bar item: offline / connecting / "Live · N" with a pulsing dot. */
export function CollabStatusItem() {
  const { status, peers, connectedPeers, record, signaling } = useCollab(
    useShallow((s) => ({ status: s.status, peers: s.peers.length, connectedPeers: s.connectedPeers, record: s.record, signaling: s.signaling })),
  );
  if (status === 'off' || !record) return null;
  const others = Math.max(peers, connectedPeers);
  const strategy = strategyInfo[record.strategy]?.short;
  const title =
    status === 'live'
      ? `${others} collaborator${others === 1 ? '' : 's'} connected peer-to-peer (end-to-end encrypted)`
      : status === 'waiting'
        ? `Connected to ${signaling.connected} ${strategy} relay${signaling.connected === 1 ? '' : 's'} — edits sync as soon as a collaborator opens the project`
        : status === 'connecting'
          ? `Reaching ${strategy} signaling relays…`
          : status === 'paused'
            ? 'Collaboration paused — your edits are kept locally'
            : 'You are offline — edits are kept locally and sync when you reconnect';
  return (
    <StatusButton onClick={() => openShareDialog()} title={title} className={cn(status === 'live' && 'text-fg-muted')}>
      <StatusDot status={status} className="mr-0.5" />
      {statusLabel(status, others, strategy)}
      {record.viewOnly && (
        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-surface-2 px-1 text-[10px] ring-1 ring-border">
          <Eye /> View-only
        </span>
      )}
    </StatusButton>
  );
}
