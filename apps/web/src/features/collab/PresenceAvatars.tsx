import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Eye, X } from 'lucide-react';
import { useWorkspace } from '@/state/workspace';
import { Avatar, DropdownMenu, Kbd, Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { useCollab, type CollabPeerView } from './session';
import { stopFollowing, toggleFollow } from './follow';
import { useT } from '@/lib/i18n';
import './i18n';

const MAX_SHOWN = 4;

function PeerTooltip({ p, following }: { p: CollabPeerView; following: boolean }) {
  const t = useT();
  const path = useWorkspace((s) => (p.fileId ? s.files.find((f) => f.id === p.fileId)?.path : undefined));
  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <span className="font-semibold">
        {p.name}
        {p.viewOnly ? ` · ${t('collab.viewOnlyLower')}` : ''}
      </span>
      <span className="font-normal text-white/70">{path ? t('collab.inFile', { file: path }) : t('collab.browsing')}</span>
      <span className="font-normal text-white/50">{following ? t('collab.clickStopFollow') : t('collab.clickFollow')}</span>
    </div>
  );
}

/** Stacked avatars of the collaborators currently in the project; click to follow one. */
export function PresenceAvatars() {
  const t = useT();
  const { peers, following } = useCollab(useShallow((s) => ({ peers: s.peers, following: s.following })));
  if (!peers.length) return null;
  const shown = peers.slice(0, MAX_SHOWN);
  const rest = peers.slice(MAX_SHOWN);
  const followed = following != null ? peers.find((p) => p.clientId === following) : undefined;

  return (
    <>
      <div className="mr-1 flex items-center -space-x-1.5" aria-label={t('collab.collaborators')}>
        {shown.map((p) => {
          const isF = p.clientId === following;
          return (
            <Tooltip key={p.clientId} content={<PeerTooltip p={p} following={isF} />}>
              <button
                onClick={() => toggleFollow(p.clientId)}
                aria-label={isF ? t('collab.stopFollowingName', { name: p.name }) : t('collab.followName', { name: p.name })}
                aria-pressed={isF}
                className={cn('relative rounded-full transition-transform duration-150 hover:z-10 hover:-translate-y-0.5', isF && 'z-10')}
                style={{ boxShadow: isF ? `0 0 0 2px var(--tx-surface), 0 0 0 4px ${p.color}` : undefined }}
              >
                <Avatar name={p.name} color={p.color} size={26} ring />
                {p.viewOnly && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-surface text-fg-muted ring-1 ring-border [&_svg]:size-2.5">
                    <Eye />
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
        {rest.length > 0 && (
          <DropdownMenu
            align="end"
            trigger={
              <button className="relative flex size-[26px] items-center justify-center rounded-full bg-surface-2 text-[10.5px] font-semibold text-fg-muted ring-2 ring-surface hover:text-fg">
                +{rest.length}
              </button>
            }
            items={[
              { type: 'label', label: t('collab.followACollaborator') },
              ...rest.map((p) => ({
                label: p.name,
                checked: p.clientId === following,
                icon: <span className="block size-2.5 rounded-full" style={{ background: p.color }} />,
                onSelect: () => toggleFollow(p.clientId),
              })),
            ]}
          />
        )}
      </div>
      {followed &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[70]" style={{ boxShadow: `inset 0 0 0 2px ${followed.color}` }}>
            <div
              className="pointer-events-auto absolute left-1/2 top-[52px] flex -translate-x-1/2 animate-slide-up items-center gap-2 rounded-full py-1 pl-3 pr-1 text-[12px] font-medium text-white shadow-lg"
              style={{ background: followed.color }}
            >
              {t('collab.followingName', { name: followed.name })}
              <Kbd keys="Escape" variant="tooltip" />
              <button onClick={stopFollowing} aria-label={t('collab.stopFollowing')} className="rounded-full p-0.5 hover:bg-white/20">
                <X className="size-3.5" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
