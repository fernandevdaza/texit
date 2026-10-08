import { Fragment, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  FileCode2,
  FileInput,
  FilePen,
  FilePlus2,
  FileText,
  FolderTree,
  Pencil,
  Play,
  Plug,
  Puzzle,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/state/workspace';
import { Badge, Button, Spinner } from '@/ui';
import { DiffView, diffStats } from '../components/DiffView';
import { hasPendingReview, resolveReview, useChat, type UiPart } from '../chat/store';

type ToolPart = Extract<UiPart, { type: 'tool-call' }>;
type EditPart = Extract<UiPart, { type: 'file-edit' }>;

const toolIcons: Record<string, typeof Wrench> = {
  list_files: FolderTree,
  read_file: FileText,
  search_project: Search,
  get_active_file: FileCode2,
  get_diagnostics: TriangleAlert,
  compile: Play,
  edit_file: Pencil,
  write_file: FilePen,
  create_file: FilePlus2,
  delete_file: Trash2,
  rename_file: FileInput,
};

/** Built-in tools with friendly labels (`ai.tool.<name>.running` / `.done`). */
const KNOWN_TOOLS = new Set(Object.keys(toolIcons));

/** Interpolate React nodes into a translated template (`{name}` placeholders). */
function rich(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((chunk, i) => {
    const m = /^\{(\w+)\}$/.exec(chunk);
    return <Fragment key={i}>{m && m[1] in nodes ? nodes[m[1]] : chunk}</Fragment>;
  });
}

export const EDIT_TOOLS = new Set(['edit_file', 'write_file', 'create_file', 'delete_file', 'rename_file']);

function iconFor(name: string) {
  if (toolIcons[name]) return toolIcons[name];
  if (name.startsWith('mcp__')) return Plug;
  if (name.startsWith('plugin_')) return Puzzle;
  if (/bash|shell|command|exec/i.test(name)) return Terminal;
  return Wrench;
}

function prettyName(name: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (m) return `${m[2]} · ${m[1]}`;
  return name.replace(/^plugin_/, '').replace(/_/g, ' ');
}

function argSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.query ?? o.from ?? o.file ?? o.file_path ?? o.command ?? o.dir ?? Object.values(o).find((x) => typeof x === 'string');
  if (typeof v !== 'string') return '';
  const range = typeof o.startLine === 'number' ? `:${o.startLine}${typeof o.endLine === 'number' ? `-${o.endLine}` : ''}` : '';
  return `${v.length > 60 ? `${v.slice(0, 57)}…` : v}${range}`;
}

export function ToolCard({ part }: { part: ToolPart }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = iconFor(part.name);
  const label = KNOWN_TOOLS.has(part.name) ? t(`ai.tool.${part.name}.${part.status === 'running' ? 'running' : 'done'}`) : prettyName(part.name);
  const summary = argSummary(part.input);
  const output = part.output === 'Interrupted' ? t('ai.tool.interrupted') : part.output;
  const hasOutput = !!output?.trim();
  return (
    <div className={cn('my-1 overflow-hidden rounded-lg border text-[12px]', part.status === 'error' ? 'border-danger/30 bg-danger-soft/40' : 'border-border bg-surface-2/60')}>
      <button
        onClick={() => hasOutput && setOpen(!open)}
        className={cn('flex h-7 w-full items-center gap-2 px-2 text-left', hasOutput && 'hover:bg-hover')}
      >
        <span className={cn('flex size-4 items-center justify-center [&_svg]:size-3.5', part.status === 'error' ? 'text-danger' : 'text-fg-subtle')}>
          {part.status === 'running' ? <Spinner className="size-3.5" /> : <Icon />}
        </span>
        <span className="shrink-0 font-medium text-fg-muted" title={part.name}>
          {label}
        </span>
        {summary && <span className="min-w-0 truncate font-mono text-[11px] text-fg-subtle">{summary}</span>}
        <span className="flex-1" />
        {part.status === 'error' && <span className="text-[10.5px] font-medium text-danger">{t('ai.tool.failed')}</span>}
        {hasOutput && <ChevronRight className={cn('size-3.5 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')} />}
      </button>
      {open && hasOutput && (
        <pre className="max-h-64 overflow-auto border-t border-border bg-surface px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
          {output}
        </pre>
      )}
    </div>
  );
}

function openFile(path: string, text?: string) {
  const ws = useWorkspace.getState();
  let line = 1;
  if (text && ws.project) {
    const id = ws.project.findByPath(path);
    const cur = id ? ws.project.readText(id) : '';
    const idx = cur && text ? firstDiffLine(text, cur) : 1;
    line = idx;
  }
  ws.revealLocation(path, line);
}

function firstDiffLine(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return i + 1;
  return 1;
}

export function EditCard({ part, threadId }: { part: EditPart; threadId: string }) {
  const t = useT();
  useChat((s) => s.reviewVersion);
  const pending = part.status === 'proposed' && hasPendingReview(threadId, part.path, part.after);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? part.status === 'proposed';
  const op = part.op ?? 'edit';
  const before = part.before ?? '';
  const after = part.after ?? '';
  const stats = op === 'edit' || op === 'create' ? diffStats(before, after) : null;
  const OpIcon = op === 'delete' ? Trash2 : op === 'rename' ? FileInput : op === 'create' ? FilePlus2 : Pencil;
  const statusBadge: Record<EditPart['status'], ReactNode> = {
    proposed: <Badge tone="warning">{pending ? t('ai.edit.review') : t('ai.edit.expired')}</Badge>,
    applied: (
      <Badge tone="success">
        <Check /> {t('ai.edit.applied')}
      </Badge>
    ),
    rejected: (
      <Badge tone="neutral">
        <X /> {t('ai.edit.rejected')}
      </Badge>
    ),
  };
  return (
    <div
      className={cn(
        'my-1.5 overflow-hidden rounded-xl border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors',
        pending ? 'border-warning/40 ring-1 ring-warning/15' : 'border-border',
      )}
    >
      <div className="flex h-8 items-center gap-2 pl-2 pr-1.5">
        <button onClick={() => setOpen(!expanded)} className="flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg">
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <OpIcon className="size-3.5 shrink-0 text-fg-subtle" />
        <button
          onClick={() => op !== 'delete' && openFile(part.newPath ?? part.path, after)}
          className="min-w-0 truncate font-mono text-[11.5px] font-medium text-fg hover:text-accent hover:underline"
          title={t('ai.edit.openInEditor')}
        >
          {op === 'rename' ? `${part.path} → ${part.newPath}` : part.path}
        </button>
        {stats && (
          <span className="shrink-0 font-mono text-[10.5px]">
            <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
          </span>
        )}
        <span className="flex-1" />
        {statusBadge[part.status]}
      </div>
      {expanded && (
        <div className="border-t border-border">
          {op === 'delete' ? (
            <div className="px-3 py-2 text-[12px] text-fg-muted">{t('ai.edit.willDelete')}</div>
          ) : op === 'rename' ? (
            <div className="px-3 py-2 text-[12px] text-fg-muted">
              {rich(t('ai.edit.renameTo'), {
                from: <span className="font-mono">{part.path}</span>,
                to: <span className="font-mono">{part.newPath}</span>,
              })}
            </div>
          ) : (
            <DiffView before={before} after={after} />
          )}
        </div>
      )}
      {pending && (
        <div className="flex items-center justify-end gap-1.5 border-t border-border bg-surface-2/50 px-2 py-1.5">
          <span className="mr-auto pl-1 text-[11px] text-fg-subtle">{t('ai.edit.waiting')}</span>
          <Button size="xs" variant="ghost" icon={<X />} onClick={() => resolveReview(threadId, part.path, part.after, false)}>
            {t('ai.edit.reject')}
          </Button>
          <Button size="xs" variant="primary" icon={<Check />} onClick={() => resolveReview(threadId, part.path, part.after, true)}>
            {t('ai.edit.accept')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Reasoning({ text, active }: { text: string; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-[11.5px] text-fg-subtle hover:text-fg">
        <Brain className="size-3.5" />
        <span className={cn(active && 'animate-pulse')}>{active ? t('ai.thinking') : t('ai.thoughtProcess')}</span>
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-[12px] leading-relaxed text-fg-subtle">{text.trim()}</div>}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="my-1.5 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-2.5 py-2 text-[12px]">
      <AlertCircle className="mt-px size-3.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 break-words text-fg">{message}</div>
      {onRetry && (
        <Button size="xs" variant="secondary" icon={<RotateCcw />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
