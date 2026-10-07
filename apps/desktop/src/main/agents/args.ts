/**
 * Pure command-line builders for the supported CLI agents (unit tested).
 *
 * Prompts are passed on stdin whenever the CLI supports it: it avoids argv
 * length limits (8 KB through Windows .cmd shims), shell-quoting pitfalls and
 * leaking prompts through `ps`. Secrets (MCP bearer tokens) are passed through
 * environment variables or 0600 temp files, never on the command line.
 */
import path from 'node:path';
import type { CliAgentRunRequest } from '@texit/core';

export interface AgentCommand {
  args: string[];
  /** Data written to stdin (then stdin is closed). */
  stdin?: string;
  env: Record<string, string>;
  /** Temp files to create (mode 0600) before spawning and delete afterwards. */
  files: { path: string; content: string }[];
  /** Notes surfaced to the user as stderr events (e.g. unsupported options). */
  notes: string[];
}

export interface BuildContext {
  /** Directory for per-run temp files. */
  tmpDir: string;
  runId: string;
}

type McpServer = NonNullable<CliAgentRunRequest['mcpServers']>[number];

/** Keep MCP server names usable as TOML keys / tool prefixes. */
export function mcpName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'server';
}

function bearerOf(headers: Record<string, string> | undefined): { token?: string; rest: Record<string, string> } {
  const rest: Record<string, string> = {};
  let token: string | undefined;
  for (const [k, v] of Object.entries(headers ?? {})) {
    const m = k.toLowerCase() === 'authorization' ? /^Bearer\s+(.+)$/i.exec(v) : null;
    if (m) token = m[1].trim();
    else rest[k] = v;
  }
  return { token, rest };
}

/** TOML basic string. */
export function tomlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

// ───────────────────────────── Codex ─────────────────────────────

export function buildCodexCommand(req: CliAgentRunRequest): AgentCommand {
  const env: Record<string, string> = {};
  const resume = !!req.sessionId;
  const args = resume ? ['exec', 'resume', '--json', '--skip-git-repo-check'] : ['exec', '--json', '--skip-git-repo-check'];
  if (!resume) args.push('-C', req.cwd);
  if (req.model) args.push('-m', req.model);
  const sandbox = req.autoApprove ? 'workspace-write' : 'read-only';
  // `codex exec resume` has no --sandbox flag: use the equivalent config override.
  if (resume) args.push('-c', `sandbox_mode=${tomlString(sandbox)}`);
  else args.push('-s', sandbox);
  (req.mcpServers ?? []).forEach((s: McpServer, i) => {
    const name = mcpName(s.name);
    args.push('-c', `mcp_servers.${name}.url=${tomlString(s.url)}`);
    const { token, rest } = bearerOf(s.headers);
    if (token) {
      const envName = `TEXIT_MCP_TOKEN_${i}`;
      env[envName] = token;
      args.push('-c', `mcp_servers.${name}.bearer_token_env_var=${tomlString(envName)}`);
    }
    const extra = Object.entries(rest);
    if (extra.length) {
      args.push('-c', `mcp_servers.${name}.http_headers={${extra.map(([k, v]) => `${tomlString(k)}=${tomlString(v)}`).join(',')}}`);
    }
  });
  if (resume) args.push(req.sessionId!);
  args.push('-'); // read the prompt from stdin
  return { args, stdin: req.prompt, env, files: [], notes: [] };
}

// ───────────────────────────── Claude Code ─────────────────────────────

export function buildClaudeCommand(req: CliAgentRunRequest, ctx: BuildContext): AgentCommand {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  const files: AgentCommand['files'] = [];
  if (req.model) args.push('--model', req.model);
  if (req.sessionId) args.push('--resume', req.sessionId);
  if (req.autoApprove) args.push('--permission-mode', 'acceptEdits');
  const servers = req.mcpServers ?? [];
  if (servers.length) {
    const mcpServers: Record<string, unknown> = {};
    for (const s of servers) mcpServers[mcpName(s.name)] = { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    const file = path.join(ctx.tmpDir, `texit-${ctx.runId}-claude-mcp.json`);
    files.push({ path: file, content: JSON.stringify({ mcpServers }) });
    // Servers handed to the agent by TexIt are trusted: allow their tools without prompting
    // (in -p mode a permission prompt would otherwise be denied).
    args.push('--allowedTools', servers.map((s) => `mcp__${mcpName(s.name)}`).join(','));
    args.push('--mcp-config', file);
  }
  return { args, stdin: req.prompt, env: {}, files, notes: [] };
}

// ───────────────────────────── Gemini CLI / Qwen Code ─────────────────────────────

export function buildGeminiCommand(req: CliAgentRunRequest, ctx: BuildContext, flavor: 'gemini' | 'qwen' = 'gemini'): AgentCommand {
  // Piped stdin makes the CLI run headless; the prompt is read from it.
  const args = ['-o', 'stream-json'];
  const env: Record<string, string> = {};
  const files: AgentCommand['files'] = [];
  const notes: string[] = [];
  if (req.model) args.push('-m', req.model);
  if (req.sessionId) args.push('--resume', req.sessionId);
  if (req.autoApprove) args.push('--yolo');
  if (flavor === 'gemini') {
    // Headless runs refuse untrusted folders; the agent cwd was chosen by the user / TexIt.
    env.GEMINI_CLI_TRUST_WORKSPACE = 'true';
  }
  const servers = req.mcpServers ?? [];
  if (servers.length) {
    if (flavor === 'gemini') {
      const mcpServers: Record<string, unknown> = {};
      for (const s of servers) mcpServers[mcpName(s.name)] = { httpUrl: s.url, ...(s.headers ? { headers: s.headers } : {}), trust: true };
      // Lowest-priority settings layer: merged with (not replacing) the user's own settings.
      const file = path.join(ctx.tmpDir, `texit-${ctx.runId}-gemini-settings.json`);
      files.push({ path: file, content: JSON.stringify({ mcpServers }) });
      env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH = file;
    } else {
      notes.push('MCP servers are not forwarded to Qwen Code yet; configure them with `qwen mcp add`.');
    }
  }
  return { args, stdin: req.prompt, env, files, notes };
}

// ───────────────────────────── OpenCode ─────────────────────────────

export function buildOpencodeCommand(req: CliAgentRunRequest): AgentCommand {
  const args = ['run', '--format', 'json', '--dir', req.cwd];
  const env: Record<string, string> = {};
  if (req.model) args.push('-m', req.model);
  if (req.sessionId) args.push('-s', req.sessionId);
  if (req.autoApprove) args.push('--auto');
  const servers = req.mcpServers ?? [];
  if (servers.length) {
    const mcp: Record<string, unknown> = {};
    for (const s of servers) mcp[mcpName(s.name)] = { type: 'remote', url: s.url, enabled: true, ...(s.headers ? { headers: s.headers } : {}) };
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp });
  }
  args.push('--', req.prompt);
  return { args, env, files: [], notes: [] };
}

// ───────────────────────────── Aider ─────────────────────────────

export function buildAiderCommand(req: CliAgentRunRequest): AgentCommand {
  const args = ['--message', req.prompt, '--no-pretty', '--no-fancy-input', '--no-auto-commits', '--no-check-update', '--no-show-release-notes', '--no-analytics'];
  if (req.model) args.push('--model', req.model);
  if (req.autoApprove) args.push('--yes-always');
  const notes: string[] = [];
  if (req.mcpServers?.length) notes.push('Aider does not support MCP servers; they were not forwarded.');
  if (req.sessionId) notes.push('Aider has no resumable sessions; starting a new one.');
  return { args, env: {}, files: [], notes };
}

export function buildAgentCommand(req: CliAgentRunRequest, ctx: BuildContext): AgentCommand {
  switch (req.agent) {
    case 'codex':
      return buildCodexCommand(req);
    case 'claude':
      return buildClaudeCommand(req, ctx);
    case 'gemini':
      return buildGeminiCommand(req, ctx, 'gemini');
    case 'qwen':
      return buildGeminiCommand(req, ctx, 'qwen');
    case 'opencode':
      return buildOpencodeCommand(req);
    case 'aider':
      return buildAiderCommand(req);
    default:
      throw new Error(`Unsupported agent: ${req.agent}`);
  }
}
