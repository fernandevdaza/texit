/**
 * Runs chat turns: builds tools + prompt, streams `AgentEvent`s from `runAgent` (API
 * providers) or `runCliAgent` (desktop subscription CLIs) into the thread, batched per
 * animation frame for smooth rendering.
 */
import type { AgentEvent, ChatAttachment, ChatMessage } from '@texit/ai';
import { host } from '@/lib/platform';
import { useLayout, useWorkspace } from '@/state/workspace';
import { t } from '@/lib/i18n';
import { loadAi } from '../sdk';
import { NEW_CHAT_TITLE, withLanguageInstruction } from '../i18n';
import {
  chatModelRef,
  getMcpInstructions,
  getMcpTools,
  getPluginTools,
  resolveModel,
} from '../runtime';
import { useAiSettings } from '../store';
import { activeFileInfo, createWorkspaceToolContext, mainPath } from '../projectContext';
import {
  focusComposer,
  getOrCreateThread,
  requestReview,
  resolveAllReviews,
  uid,
  updateMessage,
  updateThread,
  useChat,
  type Thread,
  type UiMessage,
  type UiPart,
} from './store';
import { prepareMirror } from './mirror';

const controllers = new Map<string, AbortController>();

function schedule(cb: () => void): () => void {
  if (typeof document !== 'undefined' && document.hidden) {
    const t = setTimeout(cb, 60);
    return () => clearTimeout(t);
  }
  const r = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(r);
}

/** Applies AgentEvents to an assistant message, flushing to the store once per frame. */
export function createApplier(threadId: string, messageId: string, initial: UiMessage) {
  let msg = initial;
  let cancel: (() => void) | null = null;
  const deleted: string[] = [];
  const flush = (save: 'debounced' | 'now' = 'debounced') => {
    cancel?.();
    cancel = null;
    const snapshot = msg;
    updateMessage(threadId, messageId, () => snapshot, save);
  };
  const touch = () => {
    if (!cancel) cancel = schedule(() => flush());
  };
  const setParts = (parts: UiPart[]) => (msg = { ...msg, parts });

  function apply(e: AgentEvent) {
    const parts = [...msg.parts];
    const last = parts[parts.length - 1];
    switch (e.type) {
      case 'text-delta':
        if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + e.text };
        else parts.push({ type: 'text', text: e.text });
        setParts(parts);
        break;
      case 'reasoning-delta':
        if (last?.type === 'reasoning') parts[parts.length - 1] = { ...last, text: last.text + e.text };
        else parts.push({ type: 'reasoning', text: e.text });
        setParts(parts);
        break;
      case 'tool-call':
        if (!parts.some((p) => p.type === 'tool-call' && p.id === e.id)) {
          parts.push({ type: 'tool-call', id: e.id, name: e.name, input: e.input, status: 'running' });
          setParts(parts);
        }
        break;
      case 'tool-result': {
        const i = parts.findIndex((p) => p.type === 'tool-call' && p.id === e.id);
        const part: UiPart = { type: 'tool-call', id: e.id, name: e.name, input: i >= 0 ? (parts[i] as any).input : {}, status: e.isError ? 'error' : 'done', output: e.output };
        if (i >= 0) parts[i] = part;
        else parts.push(part);
        setParts(parts);
        break;
      }
      case 'file-edit': {
        if (e.op === 'delete') deleted.push(e.path);
        const i = parts.findIndex(
          (p) => p.type === 'file-edit' && p.path === e.path && (e.toolCallId ? p.toolCallId === e.toolCallId : p.status === e.status && !p.toolCallId),
        );
        const prev = i >= 0 ? (parts[i] as Extract<UiPart, { type: 'file-edit' }>) : undefined;
        const part: UiPart = {
          type: 'file-edit',
          path: e.path,
          before: e.before ?? prev?.before,
          after: e.after ?? prev?.after,
          status: e.status,
          toolCallId: e.toolCallId,
          op: e.op ?? prev?.op,
          newPath: e.newPath ?? prev?.newPath,
        };
        if (i >= 0) parts[i] = part;
        else parts.push(part);
        setParts(parts);
        // Reviews need the card immediately; persist status changes right away.
        flush(e.status === 'proposed' ? 'debounced' : 'now');
        return;
      }
      case 'usage': {
        const u = msg.usage ?? {};
        msg = {
          ...msg,
          usage: {
            inputTokens: (u.inputTokens ?? 0) + (e.inputTokens ?? 0) || undefined,
            outputTokens: (u.outputTokens ?? 0) + (e.outputTokens ?? 0) || undefined,
            reasoningTokens: e.reasoningTokens ?? u.reasoningTokens,
            cachedInputTokens: e.cachedInputTokens ?? u.cachedInputTokens,
            costUsd: e.costUsd != null ? (u.costUsd ?? 0) + e.costUsd : u.costUsd,
          },
        };
        break;
      }
      case 'error':
        parts.push({ type: 'error', message: e.message });
        setParts(parts);
        break;
      case 'session':
        updateThread(threadId, (t) => ({ ...t, cli: { agent: t.cli?.agent ?? '', ...t.cli, sessionId: e.sessionId } }));
        break;
      case 'log':
        if (import.meta.env.DEV) console.debug('[texit ai]', e.text);
        return;
      case 'done':
        msg = {
          ...msg,
          status: e.reason === 'aborted' ? 'aborted' : e.reason === 'error' ? 'error' : 'done',
          durationMs: Date.now() - msg.createdAt,
          // A turn that ended before any output.
          parts: msg.parts.map((p) => (p.type === 'tool-call' && p.status === 'running' ? { ...p, status: 'error' as const, output: p.output ?? 'Interrupted' } : p)),
        };
        flush('now');
        return;
      default:
        return;
    }
    touch();
  }

  return { apply, flush, deleted, get message() {
    return msg;
  } };
}

function buildProjectState() {
  const ws = useWorkspace.getState();
  const files = ws.project?.listFiles().map((f) => ({ path: f.path, size: f.size, isText: f.isText })) ?? [];
  return { mainPath: mainPath(), files, activeFile: activeFileInfo(), diagnostics: ws.compile.diagnostics };
}

function userText(m: ChatMessage | UiMessage): string {
  return m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n').trim();
}

// ─────────────────────────── public API ───────────────────────────

export interface SendOptions {
  attachments?: ChatAttachment[];
  threadId?: string;
}

export async function sendMessage(text: string, opts: SendOptions = {}): Promise<void> {
  const thread = opts.threadId ? useChat.getState().threads[opts.threadId] : getOrCreateThread();
  if (!thread) throw new Error(t('ai.err.openProject'));
  if (useChat.getState().running[thread.id]) return;
  const ai = await loadAi();
  const now = Date.now();
  const user: UiMessage = {
    id: uid('u'),
    role: 'user',
    parts: [{ type: 'text', text }],
    attachments: opts.attachments?.length ? opts.attachments : undefined,
    createdAt: now,
    context: ai.buildProjectContext(buildProjectState()),
  };
  updateThread(thread.id, (th) => ({
    ...th,
    title: th.title === NEW_CHAT_TITLE ? text.replace(/\s+/g, ' ').slice(0, 60) || NEW_CHAT_TITLE : th.title,
    updatedAt: now,
    messages: [...th.messages, user],
  }));
  await runTurn(thread.id);
}

/** Re-run the last user turn (drops the assistant answer after it). */
export async function retryLast(threadId: string): Promise<void> {
  const t = useChat.getState().threads[threadId];
  if (!t || useChat.getState().running[threadId]) return;
  const idx = t.messages.map((m) => m.role).lastIndexOf('user');
  if (idx < 0) return;
  updateThread(threadId, (th) => ({ ...th, messages: th.messages.slice(0, idx + 1) }));
  await runTurn(threadId);
}

export function stopRun(threadId?: string) {
  const id = threadId ?? useChat.getState().activeId;
  if (!id) return;
  controllers.get(id)?.abort();
  resolveAllReviews(id, false);
}

export function isRunning(threadId?: string | null): boolean {
  const r = useChat.getState().running;
  return threadId ? !!r[threadId] : Object.keys(r).length > 0;
}

async function runTurn(threadId: string): Promise<void> {
  const settings = useAiSettings.getState();
  const ref = chatModelRef();
  const assistant: UiMessage = { id: uid('a'), role: 'assistant', parts: [], createdAt: Date.now(), status: 'streaming', model: ref };
  updateThread(threadId, (t) => ({ ...t, messages: [...t.messages, assistant] }), { save: 'none' });
  const applier = createApplier(threadId, assistant.id, assistant);
  const ac = new AbortController();
  controllers.set(threadId, ac);
  useChat.setState((s) => ({ running: { ...s.running, [threadId]: { startedAt: Date.now() } } }));

  try {
    const resolved = await resolveModel(ref);
    updateMessage(threadId, assistant.id, (m) => ({ ...m, modelLabel: `${resolved.provider.name} · ${resolved.modelId}` }), 'none');
    const thread = useChat.getState().threads[threadId]!;
    const history = thread.messages.filter((m) => m.id !== assistant.id);

    if (resolved.model === null) {
      await runCliTurn(thread, history, resolved.provider.cliAgent ?? 'claude', resolved.modelId, applier, ac.signal);
      return;
    }

    const ai = await loadAi();
    const autoApply = settings.autoApplyEdits;
    const ctx = createWorkspaceToolContext({
      reviewEdit: autoApply ? undefined : (path, _before, after) => requestReview(threadId, path, after),
      confirm: !autoApply,
    });
    const ask = settings.mode === 'ask';
    const tools = ai.createProjectTools(ctx, { autoApply, onEvent: applier.apply, include: ask ? ai.READ_ONLY_PROJECT_TOOLS : undefined });
    if (!ask) {
      Object.assign(tools, ai.pluginToolsToAiTools(getPluginTools(), { prefix: 'plugin_' }));
      try {
        Object.assign(tools, await getMcpTools());
      } catch (err) {
        console.warn('[texit] MCP tools unavailable', err);
      }
    }
    const meta = useWorkspace.getState().meta;
    const system = ai.buildSystemPrompt({
      projectName: meta?.name,
      customInstructions: withLanguageInstruction(settings.customInstructions),
      extraToolNotes: [ask ? 'Ask mode: you can only read the project. Explain or suggest changes as code blocks; do not claim to have edited files.' : '', getMcpInstructions()]
        .filter(Boolean)
        .join('\n'),
    });
    await ai.runAgent({
      model: resolved.model,
      messages: history as ChatMessage[],
      tools,
      system,
      signal: ac.signal,
      onEvent: applier.apply,
    });
  } catch (err) {
    applier.apply({ type: 'error', message: (err as Error)?.message ?? String(err) });
    applier.apply({ type: 'done', reason: 'error' });
  } finally {
    controllers.delete(threadId);
    resolveAllReviews(threadId, false);
    useChat.setState((s) => {
      const running = { ...s.running };
      delete running[threadId];
      return { running };
    });
    if (applier.message.status === 'streaming') applier.apply({ type: 'done', reason: ac.signal.aborted ? 'aborted' : 'stop' });
  }
}

async function runCliTurn(
  thread: Thread,
  history: UiMessage[],
  agent: string,
  modelId: string,
  applier: ReturnType<typeof createApplier>,
  signal: AbortSignal,
) {
  const ai = await loadAi();
  const ws = useWorkspace.getState();
  if (!host || !ws.project || !ws.session) throw new Error(t('ai.err.cliNeedsProject'));
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error(t('ai.err.nothingToSend'));
  const settings = useAiSettings.getState();
  const mirror = await prepareMirror(ws.session.id, ws.project);

  let mcpServers: { name: string; url: string; headers?: Record<string, string> }[] | undefined;
  try {
    const info = await host.mcp.serverInfo();
    if (info.running && info.url) mcpServers = [{ name: 'texit', url: info.url, headers: info.token ? { Authorization: `Bearer ${info.token}` } : undefined }];
  } catch {
    /* server not available */
  }
  const state = buildProjectState();
  const sameAgent = thread.cli?.agent === agent;
  if (!sameAgent) updateThread(thread.id, (t) => ({ ...t, cli: { agent } }));
  const sessionId = sameAgent ? thread.cli?.sessionId : undefined;
  const prompt = ai.buildCliPrompt({
    request: userText(lastUser),
    projectName: ws.meta?.name,
    mainPath: state.mainPath,
    activeFile: state.activeFile,
    diagnostics: state.diagnostics,
    attachments: lastUser.attachments,
    customInstructions: withLanguageInstruction(settings.customInstructions),
    texitMcpServerName: mcpServers ? 'texit' : undefined,
    includeGuidelines: !sessionId,
  });
  try {
    await ai.runCliAgent(host, {
      agent,
      prompt,
      cwd: mirror.dir,
      model: modelId && modelId !== 'default' ? modelId : undefined,
      sessionId,
      autoApprove: settings.mode === 'agent',
      mcpServers,
      signal,
      onEvent: applier.apply,
    });
  } finally {
    await mirror.finish(applier.deleted).catch((e) => console.error('[texit] mirror sync-back failed', e));
  }
}

/** Bridge `ask`: open the panel and send a message with optional context. */
export async function askAi(message: string, opts: { includeSelection?: boolean; includeDiagnostics?: boolean; send?: boolean } = {}) {
  useLayout.getState().set({ aiOpen: true });
  const attachments: ChatAttachment[] = [];
  if (opts.includeSelection) {
    const a = activeFileInfo();
    if (a?.selection?.text) attachments.push({ kind: 'selection', path: a.path, line: a.selection.line, text: a.selection.text });
  }
  if (opts.includeDiagnostics) {
    const diagnostics = useWorkspace.getState().compile.diagnostics;
    const log = useWorkspace.getState().compile.result?.log ?? '';
    if (diagnostics.length || log) {
      attachments.push({
        kind: 'diagnostics',
        diagnostics,
        text: undefined,
      });
      if (log) attachments.push({ kind: 'file', path: 'compile.log (tail)', text: log.split('\n').slice(-60).join('\n') });
    }
  }
  if (opts.send === false) {
    focusComposer();
    return;
  }
  await sendMessage(message, { attachments });
}
