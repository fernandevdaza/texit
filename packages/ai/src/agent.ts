/**
 * The chat agent loop: `streamText` with multi-step tool calls, adapted to `AgentEvent`s,
 * plus conversion of TexIt `ChatMessage`s into AI SDK model messages.
 */
import {
  isStepCount,
  streamText,
  type FilePart,
  type LanguageModel,
  type ModelMessage,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
  type ToolSet,
} from 'ai';
import { describeError } from './providers';
import { formatDiagnostics } from './tools';
import type { AgentDoneReason, AgentEvent, ChatAttachment, ChatMessage } from './types';

type StreamTextOptions = Parameters<typeof streamText>[0];
export type AgentProviderOptions = NonNullable<StreamTextOptions['providerOptions']>;
export type ReasoningLevel = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_MAX_STEPS = 30;
const HISTORY_TOOL_OUTPUT_CHARS = 8000;
const UI_TOOL_OUTPUT_CHARS = 20_000;

// ─────────────────────────── ChatMessage → ModelMessage ───────────────────────────

export interface ToModelMessagesOptions {
  /**
   * Tool names available in this request. Past tool calls to these tools are replayed as
   * structured tool-call/tool-result pairs; calls to other tools are dropped (their effect is
   * summarised). Omit or pass an empty set when the request has no tools.
   */
  toolNames?: ReadonlySet<string>;
  /**
   * Context prepended to the last user message when it has no stored `context`
   * (see `buildProjectContext`). Prefer storing it on the message (`ChatMessage.context`).
   */
  projectContext?: string;
  /** Max characters of each past tool output kept in history. */
  maxToolOutputChars?: number;
}

export interface ConvertedMessages {
  messages: ModelMessage[];
  /** Text of `role: 'system'` chat messages (to append to the instructions). */
  systemNotes: string[];
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(text.length - (max - head))}`;
}

/** Tool-call ids must match ^[a-zA-Z0-9_-]+$ for some providers. */
function sanitizeCallId(id: string): string {
  return (id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Parse `data:<mime>;base64,<data>`. */
export function parseDataUrl(url: string): { mediaType: string; base64: string } | null {
  const m = /^data:([^;,]+)?((?:;[^;,]+)*?);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mediaType: m[1] || 'application/octet-stream', base64: m[3] };
}

function attachmentToParts(att: ChatAttachment): (TextPart | FilePart)[] {
  switch (att.kind) {
    case 'file': {
      const path = att.path ? ` path="${escapeAttr(att.path)}"` : '';
      if (att.text == null) return [{ type: 'text', text: `<file${path} />\n(The user attached this file; read it with read_file if needed.)` }];
      return [{ type: 'text', text: `<file${path}>\n${att.text}\n</file>` }];
    }
    case 'selection': {
      const attrs = `${att.path ? ` path="${escapeAttr(att.path)}"` : ''}${att.line ? ` line="${att.line}"` : ''}`;
      return [{ type: 'text', text: `<selection${attrs}>\n${att.text ?? ''}\n</selection>` }];
    }
    case 'diagnostics': {
      const body = att.text ?? (att.diagnostics ? formatDiagnostics(att.diagnostics) : '');
      return body ? [{ type: 'text', text: `<diagnostics>\n${body}\n</diagnostics>` }] : [];
    }
    case 'image': {
      if (att.dataUrl) {
        const parsed = parseDataUrl(att.dataUrl);
        if (parsed) {
          return [{ type: 'file', mediaType: parsed.mediaType, data: { type: 'data', data: parsed.base64 }, filename: att.name ?? att.path }];
        }
        if (/^https?:\/\//.test(att.dataUrl)) {
          return [{ type: 'file', mediaType: 'image', data: { type: 'url', url: new URL(att.dataUrl) }, filename: att.name ?? att.path }];
        }
      }
      return att.path ? [{ type: 'text', text: `(Image attached: ${att.path})` }] : [];
    }
    default:
      return [];
  }
}

function toolOutputForHistory(part: Extract<ChatMessage['parts'][number], { type: 'tool-call' }>, max: number): ToolResultPart['output'] {
  if (part.status === 'running') return { type: 'error-text', value: 'Interrupted before completion; no result.' };
  const value = truncateMiddle(part.output ?? '', max);
  return part.status === 'error' ? { type: 'error-text', value: value || 'Tool failed.' } : { type: 'text', value: value || '(no output)' };
}

function assistantToModel(msg: ChatMessage, toolNames: ReadonlySet<string>, maxOut: number): ModelMessage[] {
  const out: ModelMessage[] = [];
  let content: (TextPart | ToolCallPart)[] = [];
  let results: ToolResultPart[] = [];
  const editNotes: string[] = [];
  const flush = () => {
    if (content.length) out.push({ role: 'assistant', content });
    if (results.length) out.push({ role: 'tool', content: results });
    content = [];
    results = [];
  };
  for (const part of msg.parts) {
    if (part.type === 'text') {
      if (!part.text.trim()) continue;
      if (results.length) flush();
      content.push({ type: 'text', text: part.text });
    } else if (part.type === 'tool-call') {
      if (!toolNames.has(part.name)) continue;
      const id = sanitizeCallId(part.id);
      const input = part.input && typeof part.input === 'object' ? part.input : {};
      content.push({ type: 'tool-call', toolCallId: id, toolName: part.name, input });
      results.push({ type: 'tool-result', toolCallId: id, toolName: part.name, output: toolOutputForHistory(part, maxOut) });
    } else if (part.type === 'file-edit' && part.status === 'applied') {
      editNotes.push(part.path);
    }
  }
  flush();
  // Without structured tool history, keep a trace of what was changed.
  const hadStructured = out.some((m) => m.role === 'tool');
  if (!hadStructured && editNotes.length) {
    const note = `(Files changed in this turn: ${[...new Set(editNotes)].join(', ')})`;
    const last = out[out.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content)) last.content.push({ type: 'text', text: note });
    else out.push({ role: 'assistant', content: [{ type: 'text', text: note }] });
  }
  return out;
}

function hasMeaningfulContent(msg: ChatMessage): boolean {
  return msg.parts.some((p) => (p.type === 'text' && p.text.trim()) || p.type === 'tool-call') || !!msg.attachments?.length;
}

/** Convert TexIt chat history into AI SDK model messages. Reasoning and error parts are not replayed. */
export function toModelMessages(history: ChatMessage[], opts: ToModelMessagesOptions = {}): ConvertedMessages {
  const toolNames = opts.toolNames ?? new Set<string>();
  const maxOut = opts.maxToolOutputChars ?? HISTORY_TOOL_OUTPUT_CHARS;
  const systemNotes: string[] = [];
  const msgs = history.filter((m) => {
    if (m.role === 'system') {
      const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n').trim();
      if (text) systemNotes.push(text);
      return false;
    }
    return true;
  });
  // Drop empty trailing assistant placeholders (e.g. the message being streamed into).
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant' && !hasMeaningfulContent(msgs[msgs.length - 1])) msgs.pop();
  // Conversations must start with a user turn.
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
  const messages: ModelMessage[] = [];
  msgs.forEach((msg, i) => {
    if (msg.role === 'user') {
      const parts: (TextPart | FilePart)[] = [];
      const context = msg.context ?? (i === lastUserIdx ? opts.projectContext : undefined);
      if (context?.trim()) {
        parts.push({ type: 'text', text: `<project_context>\n${context.trim()}\n</project_context>` });
      }
      for (const att of msg.attachments ?? []) parts.push(...attachmentToParts(att));
      const text = msg.parts
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n')
        .trim();
      if (text) parts.push({ type: 'text', text });
      if (parts.length) messages.push({ role: 'user', content: parts });
    } else {
      messages.push(...assistantToModel(msg, toolNames, maxOut));
    }
  });
  // No assistant prefill: newer models reject a conversation that ends with an assistant turn.
  const last = messages[messages.length - 1];
  if (last && last.role !== 'user' && last.role !== 'tool') messages.push({ role: 'user', content: 'Continue.' });
  return { messages, systemNotes };
}

// ─────────────────────────── Tool output formatting ───────────────────────────

/** Render any tool output (string, MCP CallToolResult, JSON) as display text. */
export function formatToolOutput(output: unknown, max = UI_TOOL_OUTPUT_CHARS): string {
  if (typeof output === 'string') return truncateMiddle(output, max);
  if (output == null) return '';
  const o = output as any;
  if (Array.isArray(o.content)) {
    const text = o.content
      .map((c: any) => {
        if (c?.type === 'text') return c.text;
        if (c?.type === 'image') return `[image ${c.mimeType ?? ''}]`.trim();
        if (c?.type === 'audio') return '[audio]';
        if (c?.type === 'resource') return c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]`;
        if (c?.type === 'resource_link') return `[resource ${c.uri ?? ''}]`;
        return JSON.stringify(c);
      })
      .join('\n');
    if (text) return truncateMiddle(text, max);
    if (o.structuredContent != null) return truncateMiddle(JSON.stringify(o.structuredContent, null, 2), max);
  }
  try {
    return truncateMiddle(JSON.stringify(output, null, 2), max);
  } catch {
    return String(output);
  }
}

function isErrorOutput(output: unknown): boolean {
  return !!output && typeof output === 'object' && (output as any).isError === true;
}

// ─────────────────────────── Agent loop ───────────────────────────

export interface RunAgentOptions {
  model: LanguageModel;
  messages: ChatMessage[];
  tools?: ToolSet;
  /** System prompt (see `buildSystemPrompt`). */
  system?: string;
  /** Volatile per-turn context prepended to the latest user message (see `buildProjectContext`). */
  projectContext?: string;
  signal?: AbortSignal;
  /** Maximum model steps (each tool round-trip is one step). Default 30. */
  maxSteps?: number;
  onEvent: (e: AgentEvent) => void;
  maxOutputTokens?: number;
  /** Reasoning effort, mapped per provider by the AI SDK. Leave unset for the provider default. */
  reasoning?: ReasoningLevel;
  temperature?: number;
  /** Merged over TexIt's defaults (Anthropic: summarised adaptive thinking + prompt caching). */
  providerOptions?: AgentProviderOptions;
  headers?: Record<string, string>;
  maxRetries?: number;
}

export interface RunAgentResult {
  /** All assistant text produced in this run. */
  text: string;
  finishReason: AgentDoneReason;
  steps: number;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
  error?: string;
  /** Model messages generated by this run (best effort; empty after errors). */
  responseMessages: ModelMessage[];
}

function modelInfo(model: LanguageModel): { provider: string; modelId: string } {
  if (typeof model === 'string') return { provider: 'gateway', modelId: model };
  return { provider: model.provider ?? '', modelId: model.modelId ?? '' };
}

/** Claude models that accept adaptive thinking (Opus/Sonnet 4.6+, all 5.x, Fable, Mythos). */
const ADAPTIVE_CLAUDE = /claude-(?:(?:opus|sonnet)-(?:4-[6-9]|[5-9])|fable|mythos)/;

/** TexIt's default provider options for a model (merged under the caller's). */
export function defaultProviderOptions(model: LanguageModel): AgentProviderOptions {
  const { provider, modelId } = modelInfo(model);
  if (provider.startsWith('anthropic')) {
    return {
      anthropic: {
        // Auto-cache the conversation prefix across agent steps.
        cacheControl: { type: 'ephemeral' },
        // Stream readable reasoning summaries instead of an empty "thinking…" pause.
        ...(ADAPTIVE_CLAUDE.test(modelId) ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
      },
    };
  }
  return {};
}

function mergeProviderOptions(a: AgentProviderOptions, b?: AgentProviderOptions): AgentProviderOptions {
  if (!b) return a;
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = { ...(out[k] ?? {}), ...(v ?? {}) };
  return out as AgentProviderOptions;
}

/** Wrap executable tools so `onStart` fires before execution (keeps event order deterministic). */
function wrapTools(tools: ToolSet, onStart: (id: string, name: string, input: unknown) => void): ToolSet {
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const exec = (t as any).execute as ((input: unknown, options: any) => unknown) | undefined;
    if (typeof exec !== 'function') {
      out[name] = t;
      continue;
    }
    out[name] = {
      ...(t as any),
      execute: (input: unknown, options: any) => {
        onStart(options?.toolCallId, name, input);
        return exec(input, options);
      },
    };
  }
  return out;
}

function mapFinish(reason: string | undefined): AgentDoneReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'content-filter':
    case 'tool-calls':
    case 'error':
    case 'other':
      return reason;
    default:
      return 'stop';
  }
}

/**
 * Run the chat agent. Streams `AgentEvent`s through `onEvent` and always finishes with
 * exactly one `{ type: 'done' }` event (also on abort and on errors). Never throws.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { model, onEvent, signal } = opts;
  const maxSteps = Math.max(1, opts.maxSteps ?? DEFAULT_MAX_STEPS);
  const emit = (e: AgentEvent) => {
    try {
      onEvent(e);
    } catch {
      /* a failing listener must not break the run */
    }
  };

  const announced = new Set<string>();
  const announce = (id: string, name: string, input: unknown) => {
    if (!id || announced.has(id)) return;
    announced.add(id);
    emit({ type: 'tool-call', id, name, input });
  };

  const tools = opts.tools && Object.keys(opts.tools).length ? wrapTools(opts.tools, announce) : undefined;
  const { messages, systemNotes } = toModelMessages(opts.messages, {
    toolNames: new Set(tools ? Object.keys(tools) : []),
    projectContext: opts.projectContext,
  });
  const instructions = [opts.system ?? '', ...systemNotes].filter((s) => s.trim()).join('\n\n') || undefined;

  let text = '';
  let steps = 0;
  let lastStepReason: string | undefined;
  let finish: string | undefined;
  let error: string | undefined;
  let aborted = false;
  let usage: RunAgentResult['usage'];
  let responseMessages: ModelMessage[] = [];

  if (!messages.length) {
    emit({ type: 'error', message: 'Nothing to send: the conversation has no user message.' });
    emit({ type: 'done', reason: 'error' });
    return { text, finishReason: 'error', steps, error: 'empty conversation', responseMessages };
  }

  try {
    const result = streamText({
      model,
      instructions,
      messages,
      tools,
      stopWhen: isStepCount(maxSteps),
      abortSignal: signal,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      reasoning: opts.reasoning,
      headers: opts.headers,
      maxRetries: opts.maxRetries,
      providerOptions: mergeProviderOptions(defaultProviderOptions(model), opts.providerOptions),
      // Errors are surfaced through the stream; don't log them to the console as well.
      onError: () => {},
    });

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          if (part.text) {
            text += part.text;
            emit({ type: 'text-delta', text: part.text });
          }
          break;
        case 'reasoning-delta':
          if (part.text) emit({ type: 'reasoning-delta', text: part.text });
          break;
        case 'tool-call':
          announce(part.toolCallId, part.toolName, part.input);
          break;
        case 'tool-result':
          if ((part as { preliminary?: boolean }).preliminary) break;
          announce(part.toolCallId, part.toolName, part.input);
          emit({
            type: 'tool-result',
            id: part.toolCallId,
            name: part.toolName,
            output: formatToolOutput(part.output),
            ...(isErrorOutput(part.output) ? { isError: true } : {}),
          });
          break;
        case 'tool-error':
          announce(part.toolCallId, part.toolName, part.input);
          emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: describeError(part.error).message, isError: true });
          break;
        case 'tool-output-denied':
          emit({ type: 'tool-result', id: part.toolCallId, name: part.toolName, output: 'Tool execution was denied.', isError: true });
          break;
        case 'start-step':
          for (const w of part.warnings ?? []) {
            const ww = w as { type?: string; feature?: string; details?: string; message?: string };
            emit({ type: 'log', text: `warning: ${[ww.feature, ww.details ?? ww.message].filter(Boolean).join(' — ') || ww.type || 'unknown'}` });
          }
          break;
        case 'finish-step':
          steps++;
          lastStepReason = part.finishReason;
          emit({ type: 'step-finish', finishReason: part.finishReason });
          break;
        case 'finish':
          finish = part.finishReason;
          usage = {
            inputTokens: part.totalUsage?.inputTokens,
            outputTokens: part.totalUsage?.outputTokens,
            reasoningTokens: part.totalUsage?.outputTokenDetails?.reasoningTokens,
            cachedInputTokens: part.totalUsage?.inputTokenDetails?.cacheReadTokens,
          };
          break;
        case 'error':
          if (signal?.aborted) {
            aborted = true;
          } else if (!error) {
            error = describeError(part.error).message;
            emit({ type: 'error', message: error });
          }
          break;
        case 'abort':
          aborted = true;
          break;
        default:
          break;
      }
    }
    if (!error && !aborted) {
      try {
        responseMessages = (await result.responseMessages) as ModelMessage[];
      } catch {
        /* best effort */
      }
    }
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === 'AbortError') {
      aborted = true;
    } else {
      const d = describeError(err);
      error = d.hint ? `${d.message} (${d.hint})` : d.message;
      emit({ type: 'error', message: error });
    }
  }

  if (signal?.aborted) aborted = true;
  if (usage && (usage.inputTokens != null || usage.outputTokens != null)) {
    emit({ type: 'usage', ...usage });
  }
  let reason: AgentDoneReason;
  if (aborted) reason = 'aborted';
  else if (error) reason = 'error';
  else if ((finish ?? lastStepReason) === 'tool-calls' && steps >= maxSteps) reason = 'max-steps';
  else reason = mapFinish(finish ?? lastStepReason);
  emit({ type: 'done', reason });
  return { text, finishReason: reason, steps, usage, error, responseMessages };
}
