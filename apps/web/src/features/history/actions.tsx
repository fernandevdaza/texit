import { createRoot } from 'react-dom/client';
import { promptDialog, toast } from '@/ui';
import { TooltipProvider } from '@/ui/Tooltip';
import { useWorkspace } from '@/state/workspace';
import { createSnapshot } from './service';
import { VersionDialog } from './VersionDialog';

/** "Save version…" — prompt for a name and store a named version. */
export async function saveNamedVersion(defaultLabel?: string) {
  if (!useWorkspace.getState().project) return;
  const label = await promptDialog({
    title: 'Save version',
    message: 'Named versions are never pruned automatically.',
    placeholder: 'e.g. Draft sent to supervisor',
    value: defaultLabel,
    confirmLabel: 'Save version',
  });
  if (!label) return;
  const v = await createSnapshot({ label, kind: 'named' });
  if (v) toast.success(`Saved version “${label}”`);
}

let current: { close(): void } | null = null;

/** Open the diff/restore dialog for a version (self-mounted so it survives sidebar changes). */
export function openVersion(versionId: string) {
  current?.close();
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  const handle = {
    close() {
      if (current === handle) current = null;
      setTimeout(() => {
        root.unmount();
        el.remove();
      }, 0);
    },
  };
  current = handle;
  root.render(
    <TooltipProvider>
      <VersionDialog versionId={versionId} onClose={() => handle.close()} />
    </TooltipProvider>,
  );
  // Close when the project changes.
  const unsub = useWorkspace.subscribe((s, p) => {
    if (s.session !== p.session) {
      unsub();
      handle.close();
    }
  });
}
