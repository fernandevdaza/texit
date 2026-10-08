/**
 * Chat threads for the open project. Thread bodies are persisted in IndexedDB
 * (`texit-ai/threads`), keyed per project id. Not synced to collaborators.
 */
import { create } from 'zustand';
import { createStore, del, get, set } from 'idb-keyval';
import type { ChatAttachment, ChatMessage, ChatPart, FileEditOp, ModelRef } from '@texit/ai';
import { useWorkspace } from '@/state/workspace';
import { NEW_CHAT_TITLE } from '../i18n';

export type UiPart = ChatPart & {
  /** file-edit parts */
  toolCallId?: string;
  op?: FileEditOp;
  newPath?: string;
};

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface UiMessage extends Omit<ChatMessage, 'parts'> {
  parts: UiPart[];
  status?: 'streaming' | 'done' | 'error' | 'aborted';
  usage?: TurnUsage;
  durationMs?: number;
  /** Display name of the model / agent that answered. */
  modelLabel?: string;
}

export interface Thread {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMessage[];
  /** CLI agent session for continuation. */
  cli?: { agent: string; sessionId?: string };
  /** Thread that logs tool calls from external agents (TexIt MCP server). */
  external?: boolean;
}

export interface ThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  external?: boolean;
}

const idb = typeof indexedDB !== 'undefined' ? createStore('texit-ai', 'threads') : undefined;
const indexKey = (projectId: string) => `index:${projectId}`;
const threadKey = (projectId: string, id: string) => `thread:${projectId}:${id}`;

export interface ChatState {
  projectId: string | null;
  index: ThreadMeta[];
  threads: Record<string, Thread>;
  activeId: string | null;
  /** Threads with a run in progress. */
  running: Record<string, { startedAt: number }>;
  /** Pending review keys (for re-render when reviews resolve). */
  reviewVersion: number;
  /** Text to prefill the composer with (quick actions, bridge.ask). */
  composerSeed: { text: string; nonce: number } | null;
  focusNonce: number;
}

export const useChat = create<ChatState>(() => ({
  projectId: null,
  index: [],
  threads: {},
  activeId: null,
  running: {},
  reviewVersion: 0,
  composerSeed: null,
  focusNonce: 0,
}));

export function uid(prefix = 'm'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────── persistence ───────────────────────────

/** A proposal interrupted by a reload: applied if the file already contains the proposed text. */
function staleEditStatus(path: string, after: string | undefined): 'applied' | 'rejected' {
  const p = useWorkspace.getState().project;
  const id = p?.findByPath(path);
  return id && after != null && p!.readText(id) === after ? 'applied' : 'rejected';
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function metaOf(t: Thread): ThreadMeta {
  return { id: t.id, title: t.title, updatedAt: t.updatedAt, messageCount: t.messages.length, external: t.external };
}

async function persistIndex() {
  const { projectId, index } = useChat.getState();
  if (!idb || !projectId) return;
  await set(indexKey(projectId), index, idb);
}

function scheduleSave(t: Thread, immediate = false) {
  if (!idb) return;
  clearTimeout(saveTimers.get(t.id));
  const run = () => {
    saveTimers.delete(t.id);
    const cur = useChat.getState().threads[t.id];
    if (cur) void set(threadKey(cur.projectId, cur.id), cur, idb).catch((e) => console.error('[texit] save thread', e));
  };
  if (immediate) run();
  else saveTimers.set(t.id, setTimeout(run, 600));
}

/** Switch to a project: load its thread index (bodies load on demand). */
export async function loadProject(projectId: string | null) {
  if (useChat.getState().projectId === projectId) return;
  useChat.setState({ projectId, index: [], threads: {}, activeId: null });
  if (!projectId || !idb) return;
  const index = ((await get(indexKey(projectId), idb)) as ThreadMeta[] | undefined) ?? [];
  if (useChat.getState().projectId !== projectId) return;
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  const firstChat = index.find((t) => !t.external);
  useChat.setState({ index });
  if (firstChat) await openThread(firstChat.id);
}

export async function openThread(id: string) {
  const s = useChat.getState();
  if (!s.projectId) return;
  if (!s.threads[id] && idb) {
    const t = (await get(threadKey(s.projectId, id), idb)) as Thread | undefined;
    if (t) {
      // Reviews can't survive a reload; mark stale proposals and interrupted runs.
      t.messages = t.messages.map((m) => ({
        ...m,
        status: m.status === 'streaming' ? 'aborted' : m.status,
        parts: m.parts.map((p) =>
          p.type === 'file-edit' && p.status === 'proposed'
            ? { ...p, status: staleEditStatus(p.path, p.after) }
            : p.type === 'tool-call' && p.status === 'running'
              ? { ...p, status: 'error' as const, output: p.output ?? 'Interrupted' }
              : p,
        ),
      }));
      useChat.setState((st) => ({ threads: { ...st.threads, [id]: t } }));
    }
  }
  useChat.setState({ activeId: id });
}

export function newThread(opts: { external?: boolean; title?: string; activate?: boolean } = {}): Thread | null {
  const { projectId } = useChat.getState();
  if (!projectId) return null;
  const now = Date.now();
  const t: Thread = { id: uid('t'), projectId, title: opts.title ?? NEW_CHAT_TITLE, createdAt: now, updatedAt: now, messages: [], external: opts.external };
  useChat.setState((s) => ({
    threads: { ...s.threads, [t.id]: t },
    index: [metaOf(t), ...s.index],
    activeId: opts.activate === false ? s.activeId : t.id,
  }));
  return t;
}

export async function deleteThread(id: string) {
  const s = useChat.getState();
  const threads = { ...s.threads };
  const t = threads[id];
  delete threads[id];
  const index = s.index.filter((m) => m.id !== id);
  useChat.setState({ threads, index, activeId: s.activeId === id ? (index.find((m) => !m.external)?.id ?? null) : s.activeId });
  if (s.activeId === id && useChat.getState().activeId) await openThread(useChat.getState().activeId!);
  if (idb && s.projectId) {
    await del(threadKey(t?.projectId ?? s.projectId, id), idb);
    await persistIndex();
  }
}

export function updateThread(id: string, fn: (t: Thread) => Thread, opts: { save?: 'debounced' | 'now' | 'none' } = {}) {
  const s = useChat.getState();
  const cur = s.threads[id];
  if (!cur) return;
  const next = fn(cur);
  const meta = metaOf(next);
  const known = s.index.some((m) => m.id === id);
  const index = known ? s.index.map((m) => (m.id === id ? meta : m)) : [meta, ...s.index];
  useChat.setState({ threads: { ...s.threads, [id]: next }, index });
  if (opts.save !== 'none') {
    scheduleSave(next, opts.save === 'now');
    void persistIndex();
  }
}

export function updateMessage(threadId: string, messageId: string, fn: (m: UiMessage) => UiMessage, save: 'debounced' | 'now' | 'none' = 'debounced') {
  updateThread(
    threadId,
    (t) => ({ ...t, updatedAt: Date.now(), messages: t.messages.map((m) => (m.id === messageId ? fn(m) : m)) }),
    { save },
  );
}

export function activeThread(): Thread | null {
  const s = useChat.getState();
  return s.activeId ? (s.threads[s.activeId] ?? null) : null;
}

export function getOrCreateThread(): Thread | null {
  const t = activeThread();
  if (t && !t.external) return t;
  return newThread();
}

// ─────────────────────────── reviews ───────────────────────────

interface PendingReview {
  threadId: string;
  path: string;
  after: string;
  resolve: (ok: boolean) => void;
}

const reviews = new Map<string, PendingReview>();
let reviewSeq = 0;

function bump() {
  useChat.setState((s) => ({ reviewVersion: s.reviewVersion + 1 }));
}

/** Register a pending review; resolves when the user accepts/rejects the matching card. */
export function requestReview(threadId: string, path: string, after: string): Promise<boolean> {
  return new Promise((resolve) => {
    const key = `r${++reviewSeq}`;
    reviews.set(key, {
      threadId,
      path,
      after,
      resolve: (ok) => {
        reviews.delete(key);
        resolve(ok);
        bump();
      },
    });
    bump();
  });
}

function findReview(threadId: string, path: string, after?: string): [string, PendingReview] | undefined {
  for (const entry of reviews) {
    const r = entry[1];
    if (r.threadId === threadId && r.path === path && (after === undefined || r.after === after)) return entry;
  }
  return undefined;
}

export function hasPendingReview(threadId: string, path: string, after?: string): boolean {
  return !!findReview(threadId, path, after);
}

export function resolveReview(threadId: string, path: string, after: string | undefined, ok: boolean) {
  findReview(threadId, path, after)?.[1].resolve(ok);
}

export function resolveAllReviews(threadId: string, ok: boolean) {
  for (const r of [...reviews.values()]) if (r.threadId === threadId) r.resolve(ok);
}

export function pendingReviewCount(threadId: string): number {
  let n = 0;
  for (const r of reviews.values()) if (r.threadId === threadId) n++;
  return n;
}

// ─────────────────────────── composer helpers ───────────────────────────

export function seedComposer(text: string) {
  useChat.setState({ composerSeed: { text, nonce: Date.now() } });
}

export function focusComposer() {
  useChat.setState((s) => ({ focusNonce: s.focusNonce + 1 }));
}

export type { ChatAttachment, ModelRef };
