import { describe, expect, it } from 'vitest';
import type { CliAgentRunRequest } from '@texit/core';
import { buildAgentCommand, buildClaudeCommand, buildCodexCommand, buildGeminiCommand, buildOpencodeCommand, mcpName, tomlString } from '../src/main/agents/args';

const base: CliAgentRunRequest = { runId: 'r1', agent: 'codex', prompt: 'Fix "the" typo & more', cwd: '/work/p' };
const ctx = { tmpDir: '/tmp/texit-agents', runId: 'r1' };
const mcp = [{ name: 'texit', url: 'http://127.0.0.1:4317/mcp', headers: { Authorization: 'Bearer SECRET', 'X-Project': 'p1' } }];

describe('codex', () => {
  it('new read-only run, prompt on stdin', () => {
    const c = buildCodexCommand(base);
    expect(c.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-C', '/work/p', '-s', 'read-only', '-']);
    expect(c.stdin).toBe(base.prompt);
  });

  it('auto-approve, model and MCP with the token in an env var', () => {
    const c = buildCodexCommand({ ...base, autoApprove: true, model: 'gpt-5.1-codex', mcpServers: mcp });
    expect(c.args).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-C', '/work/p', '-m', 'gpt-5.1-codex', '-s', 'workspace-write',
      '-c', 'mcp_servers.texit.url="http://127.0.0.1:4317/mcp"',
      '-c', 'mcp_servers.texit.bearer_token_env_var="TEXIT_MCP_TOKEN_0"',
      '-c', 'mcp_servers.texit.http_headers={"X-Project"="p1"}',
      '-',
    ]);
    expect(c.env).toEqual({ TEXIT_MCP_TOKEN_0: 'SECRET' });
    expect(c.args.join(' ')).not.toContain('SECRET');
  });

  it('resumes a session (resume has no -C / -s flags)', () => {
    const c = buildCodexCommand({ ...base, sessionId: 'abc-123', autoApprove: true });
    expect(c.args).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', 'abc-123', '-']);
  });
});

describe('claude', () => {
  it('basic stream-json run', () => {
    const c = buildClaudeCommand({ ...base, agent: 'claude' }, ctx);
    expect(c.args).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(c.stdin).toBe(base.prompt);
    expect(c.files).toEqual([]);
  });

  it('auto-approve, resume, model and MCP config file', () => {
    const c = buildClaudeCommand({ ...base, agent: 'claude', autoApprove: true, sessionId: 's-9', model: 'sonnet', mcpServers: mcp }, ctx);
    expect(c.args).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--resume', 's-9', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'mcp__texit', '--mcp-config', '/tmp/texit-agents/texit-r1-claude-mcp.json',
    ]);
    expect(JSON.parse(c.files[0].content)).toEqual({ mcpServers: { texit: { type: 'http', url: mcp[0].url, headers: mcp[0].headers } } });
    expect(c.args.join(' ')).not.toContain('SECRET');
  });
});

describe('gemini / qwen', () => {
  it('headless stream-json with yolo and trusted workspace', () => {
    const c = buildGeminiCommand({ ...base, agent: 'gemini', autoApprove: true, model: 'gemini-2.5-pro', sessionId: 'latest' }, ctx);
    expect(c.args).toEqual(['-o', 'stream-json', '-m', 'gemini-2.5-pro', '--resume', 'latest', '--yolo']);
    expect(c.env.GEMINI_CLI_TRUST_WORKSPACE).toBe('true');
    expect(c.stdin).toBe(base.prompt);
  });

  it('MCP servers through a system-defaults settings file', () => {
    const c = buildGeminiCommand({ ...base, agent: 'gemini', mcpServers: mcp }, ctx);
    expect(c.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH).toBe('/tmp/texit-agents/texit-r1-gemini-settings.json');
    expect(JSON.parse(c.files[0].content).mcpServers.texit).toMatchObject({ httpUrl: mcp[0].url, trust: true });
  });

  it('qwen notes unsupported MCP forwarding', () => {
    const c = buildAgentCommand({ ...base, agent: 'qwen', mcpServers: mcp }, ctx);
    expect(c.notes.length).toBe(1);
    expect(c.env.GEMINI_CLI_TRUST_WORKSPACE).toBeUndefined();
  });
});

describe('opencode / aider', () => {
  it('opencode passes the prompt after --', () => {
    const c = buildOpencodeCommand({ ...base, agent: 'opencode', autoApprove: true, model: 'anthropic/claude-sonnet', sessionId: 'ses_1', mcpServers: mcp });
    expect(c.args).toEqual(['run', '--format', 'json', '--dir', '/work/p', '-m', 'anthropic/claude-sonnet', '-s', 'ses_1', '--auto', '--', base.prompt]);
    expect(JSON.parse(c.env.OPENCODE_CONFIG_CONTENT).mcp.texit).toMatchObject({ type: 'remote', url: mcp[0].url });
  });

  it('aider uses --message and --yes-always', () => {
    const c = buildAgentCommand({ ...base, agent: 'aider', autoApprove: true }, ctx);
    expect(c.args.slice(0, 2)).toEqual(['--message', base.prompt]);
    expect(c.args).toContain('--yes-always');
  });

  it('rejects unknown agents', () => {
    expect(() => buildAgentCommand({ ...base, agent: 'nope' }, ctx)).toThrow(/Unsupported/);
  });
});

describe('helpers', () => {
  it('sanitises names and escapes TOML', () => {
    expect(mcpName('tex it/1')).toBe('tex_it_1');
    expect(tomlString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });
});
