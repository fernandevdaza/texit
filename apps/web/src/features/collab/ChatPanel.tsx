import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MessageCircle, SendHorizontal, Users } from 'lucide-react';
import type { ProjectDoc } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { Avatar, Button, EmptyState, IconButton, PanelHeader } from '@/ui';
import { cn } from '@/lib/cn';
import { getChat, isValidMessage, MAX_CHAT_LENGTH, sendChatMessage, setLastRead, type ChatMessage } from './chat';
import { openShareDialog, useCollab } from './session';
import { useCollabSettings } from './settings';

function useChatMessages(project: ProjectDoc | null): ChatMessage[] {
  const cache = useRef<{ project: ProjectDoc | null; list: ChatMessage[] }>({ project: null, list: [] });
  return useSyncExternalStore(
    (cb) => {
      if (!project) return () => {};
      const arr = getChat(project);
      const h = () => {
        cache.current = { project, list: arr.toArray().filter(isValidMessage) };
        cb();
      };
      arr.observe(h);
      return () => arr.unobserve(h);
    },
    () => {
      if (cache.current.project !== project) cache.current = { project, list: project ? getChat(project).toArray().filter(isValidMessage) : [] };
      return cache.current.list;
    },
  );
}

const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function ChatPanel() {
  const project = useWorkspace((s) => s.project);
  const projectId = useWorkspace((s) => s.session?.id ?? null);
  const shared = useCollab((s) => !!s.record);
  const me = useCollabSettings((s) => s.localUserId);
  const messages = useChatMessages(project);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mark as read while visible.
  useEffect(() => {
    if (!projectId) return;
    const last = messages[messages.length - 1];
    if (last) setLastRead(projectId, Math.max(last.ts, Date.now()));
    useCollab.setState({ unreadChat: 0 });
  }, [messages, projectId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = () => {
    if (!project || !draft.trim()) return;
    sendChatMessage(project, draft);
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Chat"
        actions={
          !shared && (
            <IconButton label="Share project" size="xs" onClick={() => openShareDialog()}>
              <Users />
            </IconButton>
          )
        }
      />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {messages.length === 0 ? (
          <EmptyState
            icon={<MessageCircle />}
            title="No messages yet"
            description={
              shared
                ? 'Messages are saved in the project and synced end-to-end encrypted with everyone who has it.'
                : 'Share the project to chat with collaborators. Messages are stored inside the project.'
            }
            action={
              !shared && (
                <Button size="sm" variant="primary" icon={<Users />} onClick={() => openShareDialog()}>
                  Share project
                </Button>
              )
            }
          />
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped = prev && prev.uid === m.uid && m.ts - prev.ts < 5 * 60_000;
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            const mine = m.uid === me;
            return (
              <div key={m.id ?? i}>
                {newDay && (
                  <div className="my-2 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-subtle">
                    <span className="h-px flex-1 bg-border" />
                    {day(m.ts)}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className={cn('flex gap-2', grouped ? 'mt-0.5' : 'mt-2.5')}>
                  <div className="w-6 shrink-0">{!grouped && <Avatar name={m.name} color={m.color} size={24} />}</div>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="truncate text-[12px] font-semibold" style={{ color: m.color }}>
                          {m.name}
                          {mine && <span className="font-normal text-fg-subtle"> (you)</span>}
                        </span>
                        <span className="text-[10.5px] text-fg-subtle">{time(m.ts)}</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg">{m.text}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-xs focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
          <textarea
            ref={inputRef}
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            rows={1}
            placeholder="Message collaborators…"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-[140px] min-h-[20px] flex-1 resize-none bg-transparent text-[12.5px] leading-snug text-fg outline-none placeholder:text-fg-subtle"
          />
          <IconButton label="Send (Enter)" size="xs" variant="subtle" disabled={!draft.trim()} onClick={send}>
            <SendHorizontal />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
