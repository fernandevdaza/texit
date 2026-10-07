/**
 * Subscription CLI agents (Codex CLI, Claude Code, Gemini CLI, opencode…) run by the desktop
 * host. This module only adapts the host's `CliAgentEvent` stream to TexIt `AgentEvent`s and
 * builds the prompt; the desktop app mirrors the project to `cwd` and syncs changes back.
 */
import type { CliAgentEvent, CliAgentId, Diagnostic, TexitHost } from '@texit/core';
import { formatDiagnostics } from './tools';
import type { AgentDoneReason, AgentEvent, ChatAttachment, SuggestedModel } from './types';

export interface CliAgentPreset {
  id: CliAgentId;
  label: string;
  description: string;
  /** How to install and sign in (shown when `detect()` reports it missing). */
  installHint: string;
  docsUrl: string;
  /** Model ids/aliases the CLI accepts; empty model → the CLI's own default. */
  suggestedModels: SuggestedModel[];
  /** Whether the CLI can resume a previous session (`sessionId`). */
  supportsSessions: boolean;
}

export const CLI_AGENT_PRESETS: readonly CliAgentPreset[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Anthropic’s coding agent — uses your Claude subscription.',
    installHint: 'Install with `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in.',
    docsUrl: 'https://docs.claude.com/en/docs/claude-code/overview',
    suggestedModels: [
      { id: 'opus', label: 'Opus (latest)' },
      { id: 'sonnet', label: 'Sonnet (latest)' },
      { id: 'haiku', label: 'Haiku (latest)', tags: ['fast'] },
    ],
    supportsSessions: true,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'OpenAI’s coding agent — uses your ChatGPT plan.',
    installHint: 'Install with `npm install -g @openai/codex`, then run `codex login`.',
    docsUrl: 'https://developers.openai.com/codex/cli',
    suggestedModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    ],
    supportsSessions: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    description: 'Google’s coding agent — uses your Google account / Gemini plan.',
    installHint: 'Install with `npm install -g @google/gemini-cli`, then run `gemini` once to sign in.',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    suggestedModels: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tags: ['fast'] },
    ],
    supportsSessions: true,
  },
  {
    id: 'opencode',
    label: 'opencode',
    description: 'Open-source coding agent that works with many providers and subscriptions.',
    installHint: 'Install with `npm install -g opencode-ai`, then run `opencode auth login`.',
    docsUrl: 'https://opencode.ai/docs',
    suggestedModels: [],
    supportsSessions: true,
  },
];

export function getCliAgentPreset(id: CliAgentId): CliAgentPreset | undefined {
  return CLI_AGENT_PRESETS.find((p) => p.id === id);
}

// ─────────────────────────── Prompt ───────────────────────────

export interface CliPromptOptions {
  /** The user's request. */
  request: string;
  projectName?: string;
  mainPath?: string | null;
  activeFile?: { path: string; selection?: { text: string; line: number } } | null;
  diagnostics?: Diagnostic[];
  attachments?: ChatAttachment[];
  customInstructions?: string;
  /** TexIt's MCP server is passed to the CLI (enables its compile/get_diagnostics tools). */
  texitMcpServerName?: string;
  /** Include the working guidelines (default true; set false when continuing a session that already has them). */
  includeGuidelines?: boolean;
}

/** Build the prompt for a CLI agent run: guidelines, editor context, then the request. */
export function buildCliPrompt(opts: CliPromptOptions): string {
  const sections: string[] = [];
  if (opts.includeGuidelines !== false) {
    const g: string[] = [
      `You are helping with a LaTeX project${opts.projectName ? ` called "${opts.projectName}"` : ''} in TexIt. The current directory is a mirror of the project; files you change here are synced back into the editor automatically.`,
    ];
    if (opts.mainPath) g.push(`The main document is \`${opts.mainPath}\`.`);
    const rules = [
      'Edit files in place with minimal, targeted changes. Keep the author’s style (indentation, macros, package choices, citation commands, language and spelling).',
      'Never invent LaTeX packages, commands, citations or BibTeX keys.',
      'Do not run destructive or system-changing commands: no `rm -rf`, no `git reset/clean/checkout/push`, no installing software, no downloads, and nothing outside this directory.',
      'Do not leave build artefacts (.aux, .log, .pdf, …) in the project — TexIt compiles the document itself.',
    ];
    if (opts.texitMcpServerName) {
      rules.push(`To verify the build, use the \`compile\` and \`get_diagnostics\` tools of the "${opts.texitMcpServerName}" MCP server instead of running LaTeX yourself.`);
    }
    rules.push('Reply in the language of the user’s request and finish with a short summary of what you changed.');
    g.push(rules.map((r) => `- ${r}`).join('\n'));
    if (opts.customInstructions?.trim()) g.push(`Additional instructions from the user:\n${opts.customInstructions.trim()}`);
    sections.push(g.join('\n\n'));
  }

  const ctx: string[] = [];
  const active = opts.activeFile;
  if (active) {
    if (active.selection?.text) {
      ctx.push(`The user has \`${active.path}\` open with this selection (starting at line ${active.selection.line}):\n\`\`\`latex\n${active.selection.text}\n\`\`\``);
    } else {
      ctx.push(`The user has \`${active.path}\` open${active.selection ? ` (cursor at line ${active.selection.line})` : ''}.`);
    }
  }
  if (opts.diagnostics?.length) ctx.push(`Latest compile diagnostics:\n${formatDiagnostics(opts.diagnostics, 15)}`);
  for (const att of opts.attachments ?? []) {
    if (att.kind === 'selection' && att.text) ctx.push(`Selected text${att.path ? ` from \`${att.path}\`` : ''}${att.line ? ` (line ${att.line})` : ''}:\n\`\`\`latex\n${att.text}\n\`\`\``);
    else if (att.kind === 'file' && att.path) ctx.push(`Relevant file: \`${att.path}\``);
    else if (att.kind === 'diagnostics') ctx.push(`Diagnostics:\n${att.text ?? formatDiagnostics(att.diagnostics ?? [])}`);
    else if (att.kind === 'image' && att.path) ctx.push(`Relevant image: \`${att.path}\``);
  }
  if (ctx.length) sections.push(`## Context\n${ctx.join('\n\n')}`);
  sections.push(`## Request\n${opts.request.trim()}`);
  return sections.join('\n\n');
}

// ─────────────────────────── Event adaptation ───────────────────────────

export interface CliEventAdapter {
  /** Feed one host event. `done` events are recorded but not forwarded (see `finish`). */
  handle(e: CliAgentEvent): void;
  /** Close dangling tool calls; returns what was observed. */
  finish(): { sessionId?: string; exitCode?: number; error?: string; text: string; changedFiles: string[] };
}

/** Stateful CliAgentEvent → AgentEvent adapter (exported for tests and custom runners). */
export function createCliEventAdapter(onEvent: (e: AgentEvent) => void): CliEventAdapter {
  const emit = (e: AgentEvent) => {
    try {
      onEvent(e);
    } catch {
      /* ignore listener errors */
    }
  };
  let seq = 0;
  const open = new Map<string, string[]>(); // tool name → open call ids (FIFO)
  let text = '';
  let lastKind: 'text' | 'tool' | 'other' = 'other';
  let sessionId: string | undefined;
  let exitCode: number | undefined;
  let error: string | undefined;
  const changed = new Set<string>();

  const newId = () => `cli-tool-${++seq}`;

  return {
    handle(e) {
      switch (e.type) {
        case 'text': {
          if (!e.text) break;
          let chunk = e.text;
          // Separate text blocks that are interleaved with tool activity.
          if (lastKind === 'tool' && text && !/\n\s*$/.test(text) && !/^\s*\n/.test(chunk)) chunk = `\n\n${chunk}`;
          text += chunk;
          lastKind = 'text';
          emit({ type: 'text-delta', text: chunk });
          break;
        }
        case 'reasoning':
          if (e.text) emit({ type: 'reasoning-delta', text: e.text });
          break;
        case 'tool': {
          lastKind = 'tool';
          if (e.status === 'started') {
            const id = newId();
            const q = open.get(e.name) ?? [];
            q.push(id);
            open.set(e.name, q);
            emit({ type: 'tool-call', id, name: e.name, input: e.input ?? {} });
          } else {
            let id = open.get(e.name)?.shift();
            if (!id) {
              id = newId();
              emit({ type: 'tool-call', id, name: e.name, input: e.input ?? {} });
            }
            emit({
              type: 'tool-result',
              id,
              name: e.name,
              output: e.output ?? (e.status === 'failed' ? 'Failed.' : ''),
              ...(e.status === 'failed' ? { isError: true } : {}),
            });
          }
          break;
        }
        case 'file-change':
          changed.add(e.path);
          emit({
            type: 'file-edit',
            path: e.path,
            status: 'applied',
            op: e.kind === 'add' ? 'create' : e.kind === 'delete' ? 'delete' : 'edit',
          });
          break;
        case 'session':
          if (e.sessionId && e.sessionId !== sessionId) {
            sessionId = e.sessionId;
            emit({ type: 'session', sessionId: e.sessionId });
          }
          break;
        case 'stderr':
          if (e.text?.trim()) emit({ type: 'log', text: e.text });
          break;
        case 'usage':
          emit({ type: 'usage', inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd });
          break;
        case 'done':
          exitCode = e.exitCode;
          if (e.error) error = e.error;
          break;
        default:
          break;
      }
    },
    finish() {
      for (const [name, ids] of open) {
        for (const id of ids) emit({ type: 'tool-result', id, name, output: 'Interrupted before completion.', isError: true });
      }
      open.clear();
      return { sessionId, exitCode, error, text, changedFiles: [...changed] };
    },
  };
}

// ─────────────────────────── Runner ───────────────────────────

export interface RunCliAgentOptions {
  agent: CliAgentId;
  /** Full prompt (see `buildCliPrompt`). */
  prompt: string;
  /** Working directory — the project mirror dir (`host.fs.projectMirrorDir(projectId)`). */
  cwd: string;
  model?: string;
  /** Continue a previous CLI session (from an earlier `session` event). */
  sessionId?: string;
  /** Let the agent write files / run commands without asking. */
  autoApprove?: boolean;
  /** MCP servers to give the CLI (e.g. TexIt's own server from `host.mcp.startServer()`). */
  mcpServers?: { name: string; url: string; headers?: Record<string, string> }[];
  env?: Record<string, string>;
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  /** Defaults to a random id. */
  runId?: string;
}

export interface RunCliAgentResult {
  exitCode: number;
  finishReason: AgentDoneReason;
  sessionId?: string;
  error?: string;
  text: string;
  /** Paths the CLI reported as changed. */
  changedFiles: string[];
}

function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run a CLI agent through the desktop host. Always emits exactly one final `done` event;
 * never throws (errors become `error` events and `finishReason: 'error'`).
 */
export async function runCliAgent(host: Pick<TexitHost, 'agents'>, opts: RunCliAgentOptions): Promise<RunCliAgentResult> {
  const runId = opts.runId ?? `cli-${randomId()}`;
  const adapter = createCliEventAdapter(opts.onEvent);
  const emit = (e: AgentEvent) => {
    try {
      opts.onEvent(e);
    } catch {
      /* ignore */
    }
  };

  if (opts.signal?.aborted) {
    emit({ type: 'done', reason: 'aborted' });
    return { exitCode: -1, finishReason: 'aborted', text: '', changedFiles: [] };
  }

  const onAbort = () => {
    void host.agents.cancel(runId).catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  let exitCode = -1;
  let thrown: string | undefined;
  try {
    const res = await host.agents.run(
      {
        runId,
        agent: opts.agent,
        prompt: opts.prompt,
        cwd: opts.cwd,
        model: opts.model || undefined,
        sessionId: opts.sessionId,
        autoApprove: opts.autoApprove,
        mcpServers: opts.mcpServers,
        env: opts.env,
      },
      (e) => adapter.handle(e),
    );
    exitCode = res?.exitCode ?? exitCode;
  } catch (err) {
    thrown = (err as Error)?.message ?? String(err);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }

  const seen = adapter.finish();
  if (seen.exitCode != null && exitCode === -1) exitCode = seen.exitCode;
  const aborted = !!opts.signal?.aborted;
  let error: string | undefined;
  if (!aborted) {
    if (thrown) error = thrown;
    else if (seen.error) error = seen.error;
    else if (exitCode !== 0) error = `${getCliAgentPreset(opts.agent)?.label ?? opts.agent} exited with code ${exitCode}.`;
    if (error) emit({ type: 'error', message: error });
  }
  const finishReason: AgentDoneReason = aborted ? 'aborted' : error ? 'error' : 'stop';
  emit({ type: 'done', reason: finishReason });
  return { exitCode, finishReason, sessionId: seen.sessionId, error, text: seen.text, changedFiles: seen.changedFiles };
}
