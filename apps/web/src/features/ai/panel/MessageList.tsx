import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, CheckCheck, Copy, FileText, Image as ImageIcon, TextSelect, TriangleAlert, X } from 'lucide-react';
import type { ChatAttachment } from '@texit/ai';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { Button, IconButton, toast } from '@/ui';
import { pendingReviewCount, resolveAllReviews, useChat, type Thread, type UiMessage } from '../chat/store';
import { retryLast } from '../chat/runner';
import { Markdown } from './Markdown';
import { EDIT_TOOLS, EditCard, ErrorCard, Reasoning, ToolCard } from './Parts';

export function AttachmentChip({ a, onRemove, suggested, onClick }: { a: ChatAttachment; onRemove?: () => void; suggested?: boolean; onClick?: () => void }) {
  const Icon = a.kind === 'selection' ? TextSelect : a.kind === 'diagnostics' ? TriangleAlert : a.kind === 'image' ? ImageIcon : FileText;
  const label =
    a.kind === 'selection'
      ? `${a.path?.split('/').pop() ?? 'Selection'}${a.line ? `:${a.line}` : ''}`
      : a.kind === 'diagnostics'
        ? `${a.diagnostics?.length ?? 0} problem${a.diagnostics?.length === 1 ? '' : 's'}`
        : a.kind === 'image'
          ? (a.name ?? 'Image')
          : (a.path?.split('/').pop() ?? 'File');
  return (
    <span
      onClick={onClick}
      title={a.kind === 'selection' ? a.text?.slice(0, 400) : a.path}
      className={cn(
        'inline-flex h-6 max-w-[200px] items-center gap-1 rounded-md border pl-1.5 pr-1 text-[11px] [&>svg]:size-3 [&>svg]:shrink-0',
        suggested ? 'cursor-pointer border-dashed border-border-strong text-fg-subtle hover:border-accent hover:text-accent' : 'border-border bg-surface text-fg-muted',
      )}
    >
      {a.kind === 'image' && a.dataUrl ? <img src={a.dataUrl} alt="" className="size-4 rounded-sm object-cover" /> : <Icon />}
      <span className="truncate">{a.kind === 'selection' ? `Selection · ${label}` : label}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex size-4 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
          aria-label="Remove attachment"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function compact(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const UserMessage = memo(function UserMessage({ m }: { m: UiMessage }) {
  const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  return (
    <div className="flex flex-col items-end gap-1 pl-8">
      {!!m.attachments?.length && (
        <div className="flex flex-wrap justify-end gap-1">
          {m.attachments.map((a, i) => (
            <AttachmentChip key={i} a={a} />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-fg ring-1 ring-accent/10">
          {text}
        </div>
      )}
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ m, threadId, isLast }: { m: UiMessage; threadId: string; isLast: boolean }) {
  const streaming = m.status === 'streaming';
  const editIds = new Set(m.parts.flatMap((p) => (p.type === 'file-edit' && p.toolCallId ? [p.toolCallId] : [])));
  const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n').trim();
  return (
    <div className="group/msg min-w-0">
      {m.parts.map((p, i) => {
        switch (p.type) {
          case 'text':
            return p.text ? <Markdown key={i} text={p.text} /> : null;
          case 'reasoning':
            return <Reasoning key={i} text={p.text} active={streaming && i === m.parts.length - 1} />;
          case 'tool-call':
            if (EDIT_TOOLS.has(p.name) && editIds.has(p.id)) return null;
            return <ToolCard key={i} part={p} />;
          case 'file-edit':
            return <EditCard key={i} part={p} threadId={threadId} />;
          case 'error':
            return <ErrorCard key={i} message={p.message} onRetry={isLast && !streaming ? () => void retryLast(threadId) : undefined} />;
          default:
            return null;
        }
      })}
      {streaming && (m.parts.length === 0 || m.parts[m.parts.length - 1].type === 'tool-call') && (
        <div className="flex items-center gap-2 py-1.5 text-[12px] text-fg-subtle">
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-pulse rounded-full bg-accent/60" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
          </span>
          {m.parts.length === 0 ? 'Working…' : null}
        </div>
      )}
      {!streaming && (
        <div className="mt-1 flex h-5 items-center gap-2 text-[10.5px] text-fg-subtle opacity-0 transition-opacity group-hover/msg:opacity-100">
          {m.modelLabel && <span className="truncate">{m.modelLabel}</span>}
          {m.usage?.inputTokens != null && (
            <span className="tabular-nums" title="Input / output tokens">
              {compact(m.usage.inputTokens)} in · {compact(m.usage.outputTokens ?? 0)} out
              {m.usage.cachedInputTokens ? ` · ${compact(m.usage.cachedInputTokens)} cached` : ''}
            </span>
          )}
          {m.usage?.costUsd != null && <span>${m.usage.costUsd.toFixed(4)}</span>}
          {m.durationMs != null && <span>{formatDuration(m.durationMs)}</span>}
          {m.status === 'aborted' && <span className="text-warning">stopped</span>}
          <span className="flex-1" />
          {text && (
            <IconButton
              size="xs"
              label="Copy answer"
              onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'))}
            >
              <Copy />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
});

export function MessageList({ thread }: { thread: Thread }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useChat((s) => s.reviewVersion);
  const pending = pendingReviewCount(thread.id);

  const scrollToBottom = (smooth = false) => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom();
  }, [thread.id]);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        className="h-full overflow-y-auto overflow-x-hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          pinned.current = atBottom;
          setShowJump(!atBottom);
        }}
      >
        <div ref={inner} className="space-y-4 px-3.5 pb-4 pt-3">
          {thread.messages.map((m, i) =>
            m.role === 'user' ? (
              <UserMessage key={m.id} m={m} />
            ) : (
              <AssistantMessage key={m.id} m={m} threadId={thread.id} isLast={i === thread.messages.length - 1} />
            ),
          )}
        </div>
      </div>
      {pending > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-elevated py-1 pl-3 pr-1 text-[11.5px] shadow-pop">
            <span className="text-fg-muted">{pending} edits waiting</span>
            <Button size="xs" variant="ghost" onClick={() => resolveAllReviews(thread.id, false)}>
              Reject all
            </Button>
            <Button size="xs" variant="primary" icon={<CheckCheck />} onClick={() => resolveAllReviews(thread.id, true)}>
              Accept all
            </Button>
          </div>
        </div>
      )}
      {showJump && pending <= 1 && (
        <button
          onClick={() => {
            pinned.current = true;
            scrollToBottom(true);
          }}
          className="absolute bottom-2 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-elevated text-fg-muted shadow-pop hover:text-fg"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="size-3.5" />
        </button>
      )}
    </div>
  );
}

