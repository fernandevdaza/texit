/**
 * Runner test with a fake `codex` CLI (a Node script) — no real agent is invoked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CliAgentEvent } from '@texit/core';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-agent-'));
const fake = path.join(dir, 'fake-codex.mjs');
fs.writeFileSync(
  fake,
  `#!${process.execPath}
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'thread.started', thread_id: 'th-1' });
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  out({ type: 'item.completed', item: { type: 'agent_message', text: 'prompt=' + input + ' args=' + process.argv.slice(2).join(' ') } });
  if (mode === 'fail') { out({ type: 'turn.failed', error: { message: 'boom' } }); process.stderr.write('oops\\n'); process.exit(0); }
  // Split a line across writes to exercise the line splitter.
  process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":3,');
  setTimeout(() => { process.stdout.write('"output_tokens":4}}\\n'); process.exit(0); }, 20);
});
`,
  { mode: 0o755 },
);

vi.mock('../src/main/agents/registry', () => ({ resolveAgentBinary: async () => fake }));
const { runAgent, cancelAgentRun } = await import('../src/main/agents/run');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('runAgent', () => {
  it('streams parsed events, passes the prompt on stdin and reports done', async () => {
    const events: CliAgentEvent[] = [];
    const r = await runAgent({ runId: 'r1', agent: 'codex', prompt: 'hello', cwd: dir }, (e) => events.push(e));
    expect(r.exitCode).toBe(0);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'th-1' });
    const text = events.find((e) => e.type === 'text') as { text: string };
    expect(text.text).toBe(`prompt=hello args=exec --json --skip-git-repo-check -C ${dir} -s read-only -`);
    expect(events).toContainEqual({ type: 'usage', inputTokens: 3, outputTokens: 4 });
    expect(events.at(-1)).toEqual({ type: 'done', exitCode: 0 });
  }, 20_000);

  it('turns in-stream failures into a non-zero done event', async () => {
    const events: CliAgentEvent[] = [];
    const r = await runAgent({ runId: 'r2', agent: 'codex', prompt: 'x', cwd: dir, env: { FAKE_MODE: 'fail' } }, (e) => events.push(e));
    expect(r.exitCode).toBe(1);
    expect(events.some((e) => e.type === 'stderr' && e.text.includes('oops'))).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done', exitCode: 1, error: 'boom' });
  }, 20_000);

  it('cancels by killing the process tree', async () => {
    const events: CliAgentEvent[] = [];
    const p = runAgent({ runId: 'r3', agent: 'codex', prompt: 'x', cwd: dir, env: { FAKE_MODE: 'hang' } }, (e) => events.push(e));
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true), { timeout: 10_000 });
    await cancelAgentRun('r3');
    const r = await p;
    expect(r.exitCode).not.toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'done', error: 'Cancelled' });
  }, 20_000);

  it('fails cleanly for a missing cwd', async () => {
    const events: CliAgentEvent[] = [];
    const r = await runAgent({ runId: 'r4', agent: 'codex', prompt: 'x', cwd: path.join(dir, 'missing') }, (e) => events.push(e));
    expect(r.exitCode).toBe(-1);
    expect(events.at(-1)).toMatchObject({ type: 'done', exitCode: -1 });
  });
});
