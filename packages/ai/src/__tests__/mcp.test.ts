import { describe, expect, it, vi } from 'vitest';
import type { HostMcp, JsonRpcMessage, McpServerToolCall } from '@texit/core';
import { runAgent } from '../agent';
import { McpManager, qualifyMcpToolName } from '../mcp';
import { collect, scriptedModel, textStep, toolResultsInPrompt, toolStep } from './helpers';
import { serveProjectTools } from '../mcp-server';
import { createInMemoryProjectContext } from '../memory-context';
import { createProjectToolDefs } from '../tools';

/** A fake desktop host whose stdio "processes" are tiny in-memory MCP servers. */
function fakeHost() {
  const onMsg = new Map<string, (m: JsonRpcMessage) => void>();
  const onExit = new Map<string, (i: { code: number | null; stderr: string }) => void>();
  const started: string[] = [];
  const stopped: string[] = [];
  const reply = (id: string, msg: Record<string, unknown>) => queueMicrotask(() => onMsg.get(id)?.({ jsonrpc: '2.0', ...msg }));
  const mcp: HostMcp = {
    startStdio: vi.fn(async (cfg) => {
      started.push(cfg.id);
    }),
    send: vi.fn(async (id: string, msg: JsonRpcMessage) => {
      const m = msg as any;
      if (m.method === 'initialize') {
        reply(id, { id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.2.3' }, instructions: 'Be nice.' } });
      } else if (m.method === 'tools/list') {
        reply(id, {
          id: m.id,
          result: {
            tools: [
              { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
              { name: 'fail', description: 'Always fails', inputSchema: { type: 'object' } },
            ],
          },
        });
      } else if (m.method === 'tools/call') {
        const isFail = m.params.name === 'fail';
        reply(id, { id: m.id, result: { content: [{ type: 'text', text: isFail ? 'nope' : `echo: ${m.params.arguments.text}` }], isError: isFail } });
      } else if (m.id != null) {
        reply(id, { id: m.id, error: { code: -32601, message: 'Method not found' } });
      }
    }),
    onMessage: (id, cb) => {
      onMsg.set(id, cb);
      return () => onMsg.delete(id);
    },
    onExit: (id, cb) => {
      onExit.set(id, cb);
      return () => onExit.delete(id);
    },
    stop: vi.fn(async (id: string) => {
      stopped.push(id);
    }),
    serverInfo: vi.fn(),
    startServer: vi.fn(async () => ({ running: true, url: 'http://127.0.0.1:4317/mcp', token: 't' })),
    stopServer: vi.fn(),
    setServerTools: vi.fn(async () => {}),
    onServerToolCall: vi.fn(() => () => {}),
    respondToolCall: vi.fn(async () => {}),
  };
  return { mcp, started, stopped, exit: (id: string, code: number, stderr: string) => onExit.get(id)?.({ code, stderr }) };
}

const stdioServer = { id: 's1', name: 'My Server', enabled: true, transport: 'stdio' as const, command: 'my-mcp', args: ['--stdio'] };

describe('McpManager', () => {
  it('connects a stdio server through the host bridge and exposes prefixed tools', async () => {
    const host = fakeHost();
    const manager = new McpManager({ host });
    const statuses: string[] = [];
    manager.onStatusChange((s) => statuses.push(s.map((x) => x.state).join(',')));
    await manager.connect([stdioServer]);

    expect(host.mcp.startStdio).toHaveBeenCalledWith(expect.objectContaining({ command: 'my-mcp', args: ['--stdio'] }));
    const [status] = manager.status();
    expect(status).toMatchObject({ id: 's1', state: 'connected', toolCount: 2, instructions: 'Be nice.', serverInfo: { name: 'fake', version: '1.2.3' } });
    expect(status.tools).toEqual(['mcp__my_server__echo', 'mcp__my_server__fail']);
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(manager.listTools()[0]).toMatchObject({ name: 'echo', qualifiedName: 'mcp__my_server__echo', description: 'Echo text' });

    const tools = manager.getTools();
    const out = await (tools['mcp__my_server__echo'] as any).execute({ text: 'hi' }, { toolCallId: '1', messages: [] });
    expect(out.content[0].text).toBe('echo: hi');
    const failed = await (tools['mcp__my_server__fail'] as any).execute({}, { toolCallId: '2', messages: [] });
    expect(failed.isError).toBe(true);

    await manager.close();
    expect(host.stopped).toHaveLength(1);
  });

  it('reports server exits, disabled servers and missing host support', async () => {
    const host = fakeHost();
    const manager = new McpManager({ host });
    await manager.connect([stdioServer, { id: 'off', name: 'Off', enabled: false, transport: 'http', url: 'https://x' }]);
    expect(manager.status().map((s) => s.state)).toEqual(['connected', 'disabled']);
    host.exit(host.started[0], 1, 'Traceback...\nModuleNotFoundError: foo');
    expect(manager.status()[0]).toMatchObject({ state: 'error', toolCount: 0, error: expect.stringContaining('ModuleNotFoundError') });
    expect(Object.keys(manager.getTools())).toEqual([]);

    await manager.reconnect('s1');
    expect(manager.status()[0].state).toBe('connected');

    const browserOnly = new McpManager({ host: null });
    await browserOnly.connect([stdioServer]);
    expect(browserOnly.status()[0]).toMatchObject({ state: 'error', error: expect.stringContaining('desktop app') });
  });

  it('reconciles config changes', async () => {
    const host = fakeHost();
    const manager = new McpManager({ host });
    await manager.connect([stdioServer]);
    await manager.connect([{ ...stdioServer, args: ['--other'] }]);
    expect(host.stopped).toHaveLength(1);
    expect(host.started).toHaveLength(2);
    await manager.connect([]);
    expect(manager.status()).toEqual([]);
    expect(host.stopped).toHaveLength(2);
  });

  it('uses the built-in HTTP/SSE transports for remote servers', async () => {
    const createClient = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const manager = new McpManager({ host: null, createClient });
    await manager.connect([{ id: 'r', name: 'Remote', enabled: true, transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } }]);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ transport: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } }, clientName: 'TexIt' }));
    expect(manager.status()[0]).toMatchObject({ state: 'error', error: expect.stringContaining('CORS') });
  });

  it('MCP tools work inside the agent loop', async () => {
    const host = fakeHost();
    const manager = new McpManager({ host });
    await manager.connect([stdioServer]);
    const { events, onEvent } = collect();
    const model = scriptedModel([toolStep([{ id: 'm1', name: 'mcp__my_server__echo', input: { text: 'hey' } }, { id: 'm2', name: 'mcp__my_server__fail', input: {} }]), textStep('done')]);
    const res = await runAgent({ model, messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'echo' }], createdAt: 0 }], tools: manager.getTools(), onEvent });
    expect(res.finishReason).toBe('stop');
    expect(events.filter((e) => e.type === 'tool-result')).toEqual([
      { type: 'tool-result', id: 'm1', name: 'mcp__my_server__echo', output: 'echo: hey' },
      { type: 'tool-result', id: 'm2', name: 'mcp__my_server__fail', output: 'nope', isError: true },
    ]);
    expect(toolResultsInPrompt(model.doStreamCalls[1].prompt as any[]).join('\n')).toContain('echo: hey');
    await manager.close();
  });

  it('qualifies tool names within provider limits', () => {
    expect(qualifyMcpToolName('github', 'create_issue')).toBe('mcp__github__create_issue');
    expect(qualifyMcpToolName('srv', 'a.b/c')).toBe('mcp__srv__a_b_c');
    expect(qualifyMcpToolName('srv', 'x'.repeat(80)).length).toBeLessThanOrEqual(64);
  });
});

describe('serveProjectTools', () => {
  it('registers tool defs and answers tool calls', async () => {
    const host = fakeHost();
    let handler!: (c: McpServerToolCall) => void;
    host.mcp.onServerToolCall = vi.fn((cb) => {
      handler = cb;
      return () => {};
    });
    const ctx = createInMemoryProjectContext({ 'main.tex': 'Hello' });
    const server = await serveProjectTools(host, createProjectToolDefs(ctx), { start: true });
    expect(server.info?.url).toBe('http://127.0.0.1:4317/mcp');
    const registered = (host.mcp.setServerTools as any).mock.calls[0][0];
    expect(registered.map((t: any) => t.name)).toContain('edit_file');
    expect(registered[0]).toEqual({ name: expect.any(String), description: expect.any(String), inputSchema: expect.objectContaining({ type: 'object' }) });

    handler({ callId: 'k1', tool: 'read_file', args: { path: 'main.tex' } });
    handler({ callId: 'k2', tool: 'read_file', args: {} });
    await vi.waitFor(() => expect(host.mcp.respondToolCall).toHaveBeenCalledTimes(2));
    const calls = (host.mcp.respondToolCall as any).mock.calls;
    expect(calls.find((c: any) => c[0] === 'k1')[1]).toEqual({ content: [{ type: 'text', text: expect.stringContaining('Hello') }] });
    expect(calls.find((c: any) => c[0] === 'k2')[1]).toMatchObject({ isError: true });
  });
});
