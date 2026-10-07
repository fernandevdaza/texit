/** Large modal: per-file diff of a version vs the current project (or vs the previous version) + restore actions. */
import { useEffect, useMemo, useState } from 'react';
import { Dialog as D } from 'radix-ui';
import { Download, FileMinus2, FilePen, FilePlus2, FileX2, History, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { Avatar, Badge, Button, EmptyState, IconButton, Segmented, Spinner, Switch, confirmDialog, toast } from '@/ui';
import type { ProjectFile } from '@texit/core';
import { MergeDiff } from './MergeDiff';
import { compareFiles, summarize, type FileChange } from './textDiff';
import { currentFiles, downloadVersionZip, loadVersionContent, previousVersion, restoreFile, restoreVersion } from './service';
import { useHistory, type VersionMeta } from './store';

export function versionTitle(v: VersionMeta): string {
  if (v.label) return v.label;
  if (v.kind === 'open') return 'Opened project';
  if (v.kind === 'safety') return 'Safety copy';
  if (v.kind === 'checkpoint') return 'Checkpoint';
  return 'Auto-save';
}

const KIND_ICON = { added: FilePlus2, deleted: FileX2, modified: FilePen, unchanged: FileMinus2 };
const KIND_TONE = { added: 'text-success', deleted: 'text-danger', modified: 'text-warning', unchanged: 'text-fg-subtle' };

export function ChangeCounts({ added, removed, className }: { added: number; removed: number; className?: string }) {
  if (!added && !removed) return null;
  return (
    <span className={cn('inline-flex gap-1.5 font-mono text-[11px] tabular-nums', className)}>
      {added > 0 && <span className="text-success">+{added}</span>}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  );
}

function asText(c: string | Uint8Array | null): string {
  return typeof c === 'string' ? c : '';
}

export function VersionDialog({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const version = useHistory((s) => s.versions.find((v) => v.id === versionId));
  const [compare, setCompare] = useState<'current' | 'previous'>('current');
  const [mode, setMode] = useState<'split' | 'unified'>(() => (window.innerWidth < 1000 ? 'unified' : 'split'));
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [sides, setSides] = useState<{ before: ProjectFile[]; after: ProjectFile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setSides(null);
    setError(null);
    (async () => {
      const content = await loadVersionContent(versionId);
      if (compare === 'current') return { before: content.files, after: currentFiles() };
      const prev = previousVersion(versionId);
      const before = prev ? (await loadVersionContent(prev.id)).files : [];
      return { before, after: content.files };
    })()
      .then((s) => alive && setSides(s))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [versionId, compare, refresh]);

  const changes = useMemo(() => (sides ? compareFiles(sides.before, sides.after, { includeUnchanged: showUnchanged }) : []), [sides, showUnchanged]);
  const summary = useMemo(() => summarize(changes), [changes]);
  const current = changes.find((c) => c.path === selected) ?? changes.find((c) => c.kind !== 'unchanged') ?? changes[0] ?? null;

  if (!version) return null;
  const labels = compare === 'current' ? ['This version', 'Current'] : ['Previous version', 'This version'];

  const doRestoreAll = async () => {
    const vsCurrent = compareFiles((await loadVersionContent(versionId)).files, currentFiles());
    const s = { modified: 0, recreated: 0, removed: 0 };
    for (const c of vsCurrent) {
      if (c.kind === 'modified') s.modified++;
      else if (c.kind === 'deleted') s.recreated++;
      else if (c.kind === 'added') s.removed++;
    }
    if (!vsCurrent.length) return toast.info('The project already matches this version.');
    const ok = await confirmDialog({
      title: 'Restore this version?',
      message: (
        <div className="space-y-2">
          <p>The project files will be changed to match “{versionTitle(version)}”:</p>
          <ul className="list-inside list-disc text-fg-muted">
            {s.modified > 0 && <li>{s.modified} file(s) reverted</li>}
            {s.recreated > 0 && <li>{s.recreated} deleted file(s) re-created</li>}
            {s.removed > 0 && <li>{s.removed} newer file(s) removed</li>}
          </ul>
          <p>A safety copy of the current state is saved first, so you can undo this. Collaborators receive the changes as regular edits.</p>
        </div>
      ),
      confirmLabel: 'Restore version',
    });
    if (!ok) return;
    setBusy('all');
    try {
      await restoreVersion(versionId);
      toast.success('Version restored', { description: 'A safety copy of the previous state was saved in History.' });
      onClose();
    } catch (err) {
      toast.error('Restore failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const doRestoreFile = async (c: FileChange) => {
    const ok = await confirmDialog({
      title: `Restore ${c.path}?`,
      message: 'The file will be set to its content in this version (a safety copy is saved first).',
      confirmLabel: 'Restore file',
    });
    if (!ok) return;
    setBusy(c.path);
    try {
      await restoreFile(versionId, c.path);
      toast.success(`Restored ${c.path}`);
      setRefresh((x) => x + 1);
    } catch (err) {
      toast.error('Restore failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const date = new Date(version.createdAt);

  return (
    <D.Root open onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/30 backdrop-blur-[2px] dark:bg-black/50" />
        <D.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,900px)] w-[calc(100vw-32px)] max-w-[1280px] -translate-x-1/2 -translate-y-1/2 animate-scale-in flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl outline-none"
        >
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className={cn('flex size-9 items-center justify-center rounded-lg', version.kind === 'named' ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent')}>
              <History className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-[15px] font-semibold tracking-tight text-fg">{versionTitle(version)}</D.Title>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-subtle">
                <span>{date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</span>
                <span className="flex items-center gap-1">
                  <Avatar name={version.author.name} color={version.author.color} size={14} /> {version.author.name}
                </span>
                <span>{version.fileCount} files</span>
                <span>{formatBytes(version.size)}</span>
              </div>
            </div>
            <Segmented
              size="sm"
              value={compare}
              onChange={setCompare}
              options={[
                { value: 'current', label: 'Compare with current', title: 'What changed since this version' },
                { value: 'previous', label: 'Changes in this version', title: 'What changed compared with the previous version' },
              ]}
            />
            <Button size="sm" icon={<Download />} onClick={() => void downloadVersionZip(versionId).catch((e) => toast.error(String(e?.message ?? e)))}>
              .zip
            </Button>
            <Button size="sm" variant="primary" icon={<RotateCcw />} loading={busy === 'all'} onClick={() => void doRestoreAll()}>
              Restore this version
            </Button>
            <D.Close asChild>
              <IconButton label="Close" size="sm">
                <X />
              </IconButton>
            </D.Close>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1">
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
              <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {summary.files} changed file{summary.files === 1 ? '' : 's'}
                </span>
                <ChangeCounts added={summary.added} removed={summary.removed} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                {!sides && !error && (
                  <div className="flex justify-center py-8 text-fg-subtle">
                    <Spinner />
                  </div>
                )}
                {sides && !changes.length && <p className="px-2 py-6 text-center text-[12px] text-fg-subtle">No differences.</p>}
                {changes.map((c) => {
                  const Icon = KIND_ICON[c.kind];
                  const active = current?.path === c.path;
                  const slash = c.path.lastIndexOf('/');
                  return (
                    <button
                      key={c.path}
                      onClick={() => setSelected(c.path)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
                        active ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                      )}
                      title={c.path}
                    >
                      <Icon className={cn('size-3.5 shrink-0', KIND_TONE[c.kind])} />
                      <span className="min-w-0 flex-1 truncate">
                        {slash >= 0 && <span className="text-fg-subtle">{c.path.slice(0, slash + 1)}</span>}
                        <span className={cn(c.kind === 'deleted' && 'line-through decoration-danger/60')}>{c.path.slice(slash + 1)}</span>
                      </span>
                      <ChangeCounts added={c.added} removed={c.removed} />
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11.5px] text-fg-muted">
                <Switch size="sm" checked={showUnchanged} onCheckedChange={setShowUnchanged} /> Show unchanged files
              </label>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col bg-surface">
              {error ? (
                <EmptyState title="Could not load this version" description={error} />
              ) : !current ? (
                sides ? <EmptyState icon={<History />} title="Identical" description={compare === 'current' ? 'The project is identical to this version.' : 'No file changed in this version.'} /> : null
              ) : (
                <>
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <span className="truncate font-mono text-[12px] text-fg">{current.path}</span>
                    <Badge tone={current.kind === 'added' ? 'success' : current.kind === 'deleted' ? 'danger' : current.kind === 'modified' ? 'warning' : 'neutral'}>
                      {compare === 'current'
                        ? { added: 'new since', deleted: 'deleted since', modified: 'changed since', unchanged: 'unchanged' }[current.kind]
                        : current.kind}
                    </Badge>
                    <div className="flex-1" />
                    <span className="hidden text-[11px] text-fg-subtle md:inline">
                      {labels[0]} → {labels[1]}
                    </span>
                    {!current.binary && (
                      <Segmented
                        size="sm"
                        value={mode}
                        onChange={setMode}
                        options={[
                          { value: 'split', label: 'Split' },
                          { value: 'unified', label: 'Unified' },
                        ]}
                      />
                    )}
                    {(compare === 'current' ? current.kind !== 'unchanged' : true) && (
                      <Button size="sm" icon={<RotateCcw />} loading={busy === current.path} onClick={() => void doRestoreFile(current)}>
                        Restore file
                      </Button>
                    )}
                  </div>
                  {mode === 'split' && !current.binary && (
                    <div className="grid grid-cols-2 border-b border-border bg-surface-2/60 text-[11px] font-medium text-fg-subtle">
                      <div className="px-3 py-1">{labels[0]}</div>
                      <div className="border-l border-border px-3 py-1">{labels[1]}</div>
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    {current.binary ? (
                      <EmptyState
                        title="Binary file"
                        description={`${current.before ? formatBytes((current.before as Uint8Array).byteLength ?? 0) : '—'} → ${
                          current.after ? formatBytes((current.after as Uint8Array).byteLength ?? 0) : '—'
                        }`}
                      />
                    ) : (
                      <MergeDiff key={`${current.path}:${mode}:${compare}`} path={current.path} before={asText(current.before)} after={asText(current.after)} mode={mode} />
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
