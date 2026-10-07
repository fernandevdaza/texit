/**
 * Known CLI agents: detection metadata and install / login hints.
 */
import type { CliAgentInfo } from '@texit/core';
import { capture, firstLine } from '../util/process';
import { which } from '../util/which';

export interface AgentDef {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  hint: string;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    hint: 'Install with `curl -fsSL https://claude.ai/install.sh | bash` (or `npm i -g @anthropic-ai/claude-code`), then run `claude` once to log in.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    hint: 'Install with `npm i -g @openai/codex` (or `brew install codex`), then run `codex login`.',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    hint: 'Install with `npm i -g @google/gemini-cli` (or `brew install gemini-cli`), then run `gemini` once to log in.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    versionArgs: ['--version'],
    hint: 'Install with `curl -fsSL https://opencode.ai/install | bash` (or `npm i -g opencode-ai`), then run `opencode auth login`.',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    hint: 'Install with `npm i -g @qwen-code/qwen-code`, then run `qwen` once to log in.',
  },
  {
    id: 'aider',
    name: 'Aider',
    bin: 'aider',
    versionArgs: ['--version'],
    hint: 'Install with `python -m pip install aider-install && aider-install` (or `pipx install aider-chat`) and set your model API key.',
  },
];

export function parseAgentVersion(output: string): string | undefined {
  const line = firstLine(output);
  if (!line) return undefined;
  return line.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)?.[0] ?? line;
}

let cache: { at: number; value: Promise<CliAgentInfo[]> } | null = null;

export function detectAgents(force = false): Promise<CliAgentInfo[]> {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.value;
  const value = Promise.all(
    AGENTS.map(async (a): Promise<CliAgentInfo> => {
      const p = await which(a.bin);
      if (!p) return { id: a.id, name: a.name, installed: false, hint: a.hint };
      const r = await capture(p, a.versionArgs, { timeoutMs: 10_000 });
      return { id: a.id, name: a.name, installed: true, path: p, version: parseAgentVersion(`${r.stdout}\n${r.stderr}`), hint: a.hint };
    }),
  );
  cache = { at: Date.now(), value };
  value.catch(() => (cache = null));
  return value;
}

export async function resolveAgentBinary(id: string): Promise<string | null> {
  const def = AGENTS.find((a) => a.id === id);
  if (!def) return null;
  const detected = (await detectAgents()).find((a) => a.id === id);
  if (detected?.path) return detected.path;
  return which(def.bin);
}
