import { useMemo } from 'react';
import { Bookmark, BookmarkPlus, Clock, Download, Eye, History, MoreHorizontal, Pencil, RotateCcw, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes, timeAgo } from '@/lib/format';
import { Avatar, Button, DropdownMenu, EmptyState, IconButton, PanelHeader, Spinner, confirmDialog, promptDialog, toast, type MenuEntry } from '@/ui';
import { useWorkspace } from '@/state/workspace';
import { useHistory, useHistoryPrefs, type VersionMeta } from './store';
import { createSnapshot, deleteVersion, downloadVersionZip, renameVersion } from './service';
import { ChangeCounts, versionTitle } from './VersionDialog';
import { openVersion, saveNamedVersion } from './actions';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function VersionItem({ v, last, onOpen }: { v: VersionMeta; last: boolean; onOpen: () => void }) {
  const named = v.kind === 'named';
  const safety = v.kind === 'safety';
  const menu: MenuEntry[] = [
    { label: 'View changes', icon: <Eye />, onSelect: onOpen },
    { label: named ? 'Rename…' : 'Name this version…', icon: <Pencil />, onSelect: () => void rename(v) },
    { label: 'Download .zip', icon: <Download />, onSelect: () => void downloadVersionZip(v.id).catch((e) => toast.error(String(e?.message ?? e))) },
    { type: 'separator' },
    { label: 'Delete version', icon: <Trash2 />, danger: true, onSelect: () => void remove(v) },
  ];
  return (
    <li className="group relative flex gap-2.5 pl-3 pr-1.5">
      {/* timeline rail */}
      <div className="relative flex w-4 shrink-0 justify-center">
        <span className={cn('absolute bottom-0 top-0 w-px bg-border', last && 'bottom-1/2')} />
        <span
          className={cn(
            'relative mt-[11px] flex items-center justify-center rounded-full ring-4 ring-surface',
            named ? 'size-4 bg-accent text-accent-fg' : safety ? 'size-3 bg-warning' : 'size-2.5 border-2 border-border-strong bg-surface',
          )}
        >
          {named && <Bookmark className="size-2.5" strokeWidth={3} />}
        </span>
      </div>
      <button onClick={onOpen} title={`${new Date(v.createdAt).toLocaleString()} · ${formatBytes(v.size)}`} className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-[12.5px]', named ? 'font-semibold text-fg' : 'text-fg-muted')}>{versionTitle(v)}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-subtle">
            {new Date(v.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-fg-subtle">
          <Avatar name={v.author.name} color={v.author.color} size={13} />
          <span className="min-w-0 truncate">{v.author.name}</span>
          {v.changes.files ? (
            <>
              <ChangeCounts added={v.changes.added} removed={v.changes.removed} className="shrink-0" />
              <span className="shrink-0">
                {v.changes.files} file{v.changes.files === 1 ? '' : 's'}
              </span>
            </>
          ) : (
            <span className="shrink-0">no changes</span>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu
          align="end"
          items={menu}
          trigger={
            <button aria-label="Version actions" className="flex size-6 items-center justify-center rounded-md bg-elevated text-fg-muted shadow-sm ring-1 ring-border hover:text-fg">
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        />
      </div>
    </li>
  );
}

async function rename(v: VersionMeta) {
  const label = await promptDialog({ title: v.kind === 'named' ? 'Rename version' : 'Name this version', value: v.label ?? '', placeholder: 'e.g. Submitted to journal', confirmLabel: 'Save' });
  if (label != null) await renameVersion(v.id, label);
}

async function remove(v: VersionMeta) {
  const ok = await confirmDialog({ title: `Delete “${versionTitle(v)}”?`, message: 'This version will be permanently removed from the history.', confirmLabel: 'Delete', danger: true });
  if (ok) await deleteVersion(v.id);
}

export function HistoryPanel() {
  const hasProject = useWorkspace((s) => !!s.project);
  const { versions, loading, dirtySince, saving } = useHistory();
  const { intervalMin, showAuto, set } = useHistoryPrefs();

  const visible = useMemo(() => (showAuto ? versions : versions.filter((v) => v.kind === 'named')), [versions, showAuto]);
  const groups = useMemo(() => {
    const out: { day: string; items: VersionMeta[] }[] = [];
    for (const v of visible) {
      const day = dayLabel(v.createdAt);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(v);
    }
    return out;
  }, [visible]);
  const totalSize = versions.reduce((n, v) => n + v.size, 0);

  if (!hasProject) return <EmptyState icon={<History />} title="History" description="Open a project to see its versions." />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="History"
        actions={
          <>
            <IconButton label="Save version…" size="xs" onClick={() => void saveNamedVersion()}>
              <BookmarkPlus />
            </IconButton>
            <DropdownMenu
              align="end"
              items={[
                { type: 'label', label: 'Automatic versions' },
                ...[2, 5, 10, 30].map((m) => ({ label: `Every ${m} minutes`, checked: intervalMin === m, onSelect: () => set({ intervalMin: m }) })),
                { label: 'Off', checked: intervalMin === 0, onSelect: () => set({ intervalMin: 0 }) },
                { type: 'separator' },
                { label: 'Show automatic versions', checked: showAuto, onSelect: () => set({ showAuto: !showAuto }) },
              ]}
              trigger={
                <button aria-label="History settings" className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg [&_svg]:size-3.5">
                  <Settings2 />
                </button>
              }
            />
          </>
        }
      />

      {/* Current state card */}
      <div className="mx-3 mb-2 rounded-xl border border-border bg-gradient-to-br from-accent-soft/70 to-transparent p-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            {dirtySince != null && <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />}
            <span className={cn('relative inline-flex size-2 rounded-full', dirtySince != null ? 'bg-warning' : 'bg-success')} />
          </span>
          <span className="text-[12.5px] font-medium text-fg">Current version</span>
          {saving && <Spinner className="size-3 text-fg-subtle" />}
        </div>
        <p className="mt-0.5 text-[11.5px] text-fg-subtle">
          {dirtySince != null ? `Edited ${timeAgo(dirtySince)} — not in a version yet` : versions.length ? 'All changes are saved in a version' : 'No versions yet'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="xs" variant="primary" icon={<BookmarkPlus />} onClick={() => void saveNamedVersion()}>
            Save version…
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<Clock />}
            disabled={dirtySince == null}
            onClick={async () => {
              const v = await createSnapshot({ kind: 'auto' });
              if (!v) toast.info('Nothing changed since the last version');
            }}
          >
            Snapshot now
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {loading ? (
          <div className="flex justify-center py-8 text-fg-subtle">
            <Spinner />
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon={<History />}
            title={versions.length ? 'No named versions' : 'No versions yet'}
            description={
              versions.length
                ? 'Name important moments with “Save version…”, or show automatic versions.'
                : `TexIt saves a version automatically every ${intervalMin || 5} minutes while you edit.`
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.day}>
              <h3 className="sticky top-0 z-10 bg-surface/95 px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle backdrop-blur">{g.day}</h3>
              <ul>
                {g.items.map((v, i) => (
                  <VersionItem key={v.id} v={v} last={i === g.items.length - 1} onOpen={() => openVersion(v.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
        <ShieldCheck className="size-3" />
        <span>
          {versions.length} version{versions.length === 1 ? '' : 's'} · {formatBytes(totalSize)} on this device
        </span>
        <span className="ml-auto" title="Restoring always saves a safety copy first">
          <RotateCcw className="size-3" />
        </span>
      </div>
    </div>
  );
}
