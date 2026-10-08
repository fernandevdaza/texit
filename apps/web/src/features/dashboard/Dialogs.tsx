import { useMemo, useState } from 'react';
import { Link2, ShieldCheck, Tag } from 'lucide-react';
import { useProjects } from '@/services/projects';
import { navigate } from '@/lib/router';
import { Button, Dialog, Input } from '@/ui';
import { useT } from '@/lib/i18n';
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
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('dashboard.join.title')}
      description={t('dashboard.join.description')}
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
  const t = useT();
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
      <div className="mt-1.5 h-4 text-[11.5px] text-danger">{v.trim() && !route ? t('dashboard.join.invalid') : ''}</div>
      <div className="mt-1 flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-[11.5px] leading-relaxed text-fg-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
        {t('dashboard.join.note')}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!route}>
          {t('dashboard.join.submit')}
        </Button>
      </div>
    </form>
  );
}

function TagsDialog() {
  const id = useDashboardUi((s) => s.tagsFor);
  const setFor = useDashboardUi((s) => s.setTagsFor);
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const t = useT();
  return (
    <Dialog
      open={!!id && !!project}
      onOpenChange={(o) => !o && setFor(null)}
      title={t('dashboard.tagsDialog.title')}
      description={project ? t('dashboard.tagsDialog.description', { name: project.name }) : undefined}
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
  const t = useT();
  const save = () => {
    void setTags(id, tags);
    onDone();
  };
  return (
    <div className="pb-2">
      <TagInput autoFocus value={tags} onChange={setLocal} suggestions={all} placeholder={t('dashboard.tagsDialog.placeholder')} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={save}>
          {t('dashboard.tagsDialog.save')}
        </Button>
      </div>
    </div>
  );
}
