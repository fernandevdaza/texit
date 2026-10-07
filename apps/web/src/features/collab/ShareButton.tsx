import { useShallow } from 'zustand/react/shallow';
import { Users } from 'lucide-react';
import { Button, Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { openShareDialog, useCollab } from './session';
import { ShareDialog } from './ShareDialog';
import { StatusDot } from './StatusItem';

/** Top-bar "Share" button (shows the number of connected collaborators) + the share dialog. */
export function ShareButton() {
  const { status, others, shared } = useCollab(
    useShallow((s) => ({ status: s.status, others: Math.max(s.peers.length, s.connectedPeers), shared: !!s.record })),
  );
  const live = status === 'live' && others > 0;
  return (
    <>
      <Tooltip content={shared ? (live ? `${others} collaborator${others === 1 ? '' : 's'} online` : 'Shared — invite link & people') : 'Share this project peer-to-peer'}>
        <Button size="sm" variant={shared ? 'secondary' : 'primary'} icon={<Users />} onClick={() => openShareDialog()} aria-label="Share">
          Share
          {shared && (
            <span
              className={cn(
                'ml-0.5 inline-flex h-4 min-w-4 items-center justify-center gap-1 rounded-full px-1 text-[10.5px] font-semibold tabular-nums',
                live ? 'bg-success-soft text-success' : 'bg-surface-2 text-fg-subtle ring-1 ring-border',
              )}
            >
              <StatusDot status={status} className="size-1.5 [&>span]:size-1.5" />
              {live ? others : null}
            </span>
          )}
        </Button>
      </Tooltip>
      <ShareDialog />
    </>
  );
}
