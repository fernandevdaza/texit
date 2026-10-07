import { useMemo, useState } from 'react';
import { Link2, ShieldCheck, Tag } from 'lucide-react';
import { useProjects } from '@/services/projects';
import { navigate } from '@/lib/router';
import { Button, Dialog, Input } from '@/ui';
import { TagInput } from '@/ui/TagInput';
import { NewProjectDialog } from './NewProjectDialog';
import { useDashboardUi } from './store';
import { parseJoinLink, setTags } from './actions';

/** Dialogs reachable from anywhere (new project, join, tags). Mounted once at the app root. */
export function DashboardDialogs() {
  return (
    <>
      <NewProjectDialog />
      <JoinDialog />
      <TagsDialog />
    </>
  );
}

function JoinDialog() {
  const open = useDashboardUi((s) => s.joinOpen);
  const setOpen = useDashboardUi((s) => s.setJoinOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Join a shared project"
      description="Paste the invite link a collaborator shared with you."
      icon={<Link2 />}
      width="max-w-md"
    >
      {open && <JoinBody onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function JoinBody({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  const route = parseJoinLink(v);
  const submit = () => {
    if (!route) return;
    onDone();
    navigate(route);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="pb-2"
    >
      <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="https://…/#/join/…" className="font-mono text-[12px]" />
      <div className="mt-1.5 h-4 text-[11.5px] text-danger">{v.trim() && !route ? 'That doesn’t look like a TexIt invite link.' : ''}</div>
      <div className="mt-1 flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-[11.5px] leading-relaxed text-fg-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
        Peer-to-peer and end-to-end encrypted. A local copy is kept on this device so you can keep working offline.
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!route}>
          Join project
        </Button>
      </div>
    </form>
  );
}

function TagsDialog() {
  const id = useDashboardUi((s) => s.tagsFor);
  const setFor = useDashboardUi((s) => s.setTagsFor);
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  return (
    <Dialog
      open={!!id && !!project}
      onOpenChange={(o) => !o && setFor(null)}
      title="Tags"
      description={project ? <>Organize “{project.name}” on your dashboard.</> : undefined}
      icon={<Tag />}
      width="max-w-md"
    >
      {project && <TagsBody key={project.id} id={project.id} initial={project.tags ?? []} onDone={() => setFor(null)} />}
    </Dialog>
  );
}

function TagsBody({ id, initial, onDone }: { id: string; initial: string[]; onDone: () => void }) {
  const [tags, setLocal] = useState(initial);
  const projects = useProjects((s) => s.projects);
  const all = useMemo(() => [...new Set(projects.flatMap((p) => p.tags ?? []))].sort(), [projects]);
  const save = () => {
    void setTags(id, tags);
    onDone();
  };
  return (
    <div className="pb-2">
      <TagInput autoFocus value={tags} onChange={setLocal} suggestions={all} placeholder="thesis, draft, 2026…" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save tags
        </Button>
      </div>
    </div>
  );
}
