/**
 * TexIt as an MCP server: Streamable HTTP on 127.0.0.1 with bearer-token auth.
 *
 * The tool list is provided by the renderer (`setServerTools`); tool calls are
 * forwarded to the renderer, which executes them against the live Y.Doc and
 * answers through `respond()`.
 *
 * Electron-free so it can be exercised from unit tests with the SDK client.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerInfo, McpServerToolCall } from '@texit/core';

export const DEFAULT_MCP_PORT = 4317;
export const TOOL_CALL_TIMEOUT_MS = 120_000;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_SESSIONS = 64;
const MCP_PATH = '/mcp';

export interface ServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolCallResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Forwards a call to the renderer. Returns false when no renderer can take it. */
export type ToolCallDispatcher = (call: McpServerToolCall) => boolean;

interface Session {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

interface Pending {
  resolve: (r: ToolCallResult) => void;
  timer: NodeJS.Timeout;
}

export interface TexitMcpServerOptions {
  /** File where the bearer token is persisted (created with mode 0600). */
  tokenFile: string;
  version: string;
  timeoutMs?: number;
}

export class TexitMcpServer {
  private httpServer: http.Server | null = null;
  private port: number | null = null;
  private token: string | null = null;
  private tools: ServerTool[] = [];
  private sessions = new Map<string, Session>();
  private pending = new Map<string, Pending>();
  private dispatcher: ToolCallDispatcher | null = null;
  private starting: Promise<McpServerInfo> | null = null;

  constructor(private readonly opts: TexitMcpServerOptions) {}

  // ───────────────────────────── public API ─────────────────────────────

  info(): McpServerInfo {
    if (!this.httpServer || this.port === null) return { running: false };
    return { running: true, url: this.url(), port: this.port, token: this.getToken() };
  }

  url(): string {
    return `http://127.0.0.1:${this.port}${MCP_PATH}`;
  }

  getToken(): string {
    if (this.token) return this.token;
    try {
      const existing = fs.readFileSync(this.opts.tokenFile, 'utf8').trim();
      if (/^[A-Za-z0-9_-]{32,}$/.test(existing)) return (this.token = existing);
    } catch {
      /* create below */
    }
    const token = randomBytes(32).toString('base64url');
    fs.mkdirSync(path.dirname(this.opts.tokenFile), { recursive: true });
    fs.writeFileSync(this.opts.tokenFile, token, { mode: 0o600 });
    return (this.token = token);
  }

  setDispatcher(fn: ToolCallDispatcher | null): void {
    this.dispatcher = fn;
  }

  setTools(tools: ServerTool[]): void {
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: normalizeSchema(t.inputSchema) }));
    for (const s of this.sessions.values()) void s.server.sendToolListChanged().catch(() => undefined);
  }

  getTools(): ServerTool[] {
    return this.tools;
  }

  respond(callId: string, result: ToolCallResult): void {
    const p = this.pending.get(callId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(callId);
    p.resolve(result);
  }

  async start(opts: { port?: number } = {}): Promise<McpServerInfo> {
    if (this.httpServer) return this.info();
    if (this.starting) return this.starting;
    this.starting = this.listen(opts.port ?? DEFAULT_MCP_PORT).finally(() => (this.starting = null));
    return this.starting;
  }

  async stop(): Promise<void> {
    const srv = this.httpServer;
    this.httpServer = null;
    this.port = null;
    for (const [id, s] of this.sessions) {
      this.sessions.delete(id);
      await s.transport.close().catch(() => undefined);
      await s.server.close().catch(() => undefined);
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(errorResult('TexIt MCP server stopped'));
      this.pending.delete(id);
    }
    if (srv) {
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        srv.closeAllConnections?.();
      });
    }
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async listen(port: number): Promise<McpServerInfo> {
    this.getToken();
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        if (!res.headersSent) sendJson(res, 500, rpcError(-32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`));
        else res.end();
      });
    });
    server.keepAliveTimeout = 30_000;
    const tryListen = (p: number) =>
      new Promise<number>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve((server.address() as AddressInfo).port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(p, '127.0.0.1');
      });
    let actual: number;
    try {
      actual = await tryListen(port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' && (err as NodeJS.ErrnoException).code !== 'EACCES') throw err;
      actual = await tryListen(0); // any free port
    }
    this.httpServer = server;
    this.port = actual;
    return this.info();
  }

  private isAllowedHost(host: string | undefined): boolean {
    if (!host) return false;
    const allowed = [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`];
    return allowed.includes(host.toLowerCase());
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header);
    if (!m) return false;
    const given = Buffer.from(m[1].trim());
    const expected = Buffer.from(this.getToken());
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // DNS-rebinding protection: only loopback Host headers, and only loopback (or absent) Origins.
    if (!this.isAllowedHost(req.headers.host)) return sendJson(res, 403, rpcError(-32000, 'Forbidden host'));
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)) {
      return sendJson(res, 403, rpcError(-32000, 'Forbidden origin'));
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== MCP_PATH) return sendJson(res, 404, rpcError(-32601, 'Not found'));
    if (!this.authorized(req)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="texit"');
      return sendJson(res, 401, rpcError(-32001, 'Unauthorized: missing or invalid bearer token'));
    }

    const sessionId = headerValue(req.headers['mcp-session-id']);
    if (req.method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY));
      } catch (err) {
        const tooLarge = err instanceof Error && err.message === 'too-large';
        return sendJson(res, tooLarge ? 413 : 400, rpcError(-32700, tooLarge ? 'Request body too large' : 'Parse error'));
      }
      if (sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s) return sendJson(res, 404, rpcError(-32001, 'Session not found'));
        s.lastSeen = Date.now();
        return s.transport.handleRequest(req, res, body);
      }
      const isInit = Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body);
      if (!isInit) return sendJson(res, 400, rpcError(-32000, 'Bad Request: no valid session ID provided'));
      const session = await this.createSession();
      return session.transport.handleRequest(req, res, body);
    }
    if (req.method === 'GET' || req.method === 'DELETE') {
      const s = sessionId ? this.sessions.get(sessionId) : undefined;
      if (!s) return sendJson(res, sessionId ? 404 : 400, rpcError(-32000, sessionId ? 'Session not found' : 'Missing session ID'));
      s.lastSeen = Date.now();
      return s.transport.handleRequest(req, res);
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, rpcError(-32000, 'Method not allowed'));
  }

  private async createSession(): Promise<Session> {
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = Array.from(this.sessions.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) {
        this.sessions.delete(oldest[0]);
        await oldest[1].transport.close().catch(() => undefined);
      }
    }
    const server = this.createMcpServer();
    let session!: Session;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    session = { server, transport, lastSeen: Date.now() };
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && this.sessions.get(id) === session) this.sessions.delete(id);
    };
    await server.connect(transport);
    return session;
  }

  private createMcpServer(): Server {
    const server = new Server(
      { name: 'texit', title: 'TexIt', version: this.opts.version },
      {
        capabilities: { tools: { listChanged: true } },
        instructions:
          'TexIt exposes the LaTeX project currently open in the TexIt editor. Use these tools to read, edit and compile it; edits are applied live to the collaborative document.',
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as any })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
      const name = request.params.name;
      if (!this.tools.some((t) => t.name === name)) return errorResult(`Unknown tool: ${name}`);
      return this.forward(name, (request.params.arguments ?? {}) as Record<string, unknown>, extra.signal);
    });
    return server;
  }

  private forward(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallResult> {
    const callId = randomUUID();
    return new Promise<ToolCallResult>((resolve) => {
      const timeoutMs = this.opts.timeoutMs ?? TOOL_CALL_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve(errorResult(`TexIt did not answer the "${tool}" call within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(callId, { resolve, timer });
      signal?.addEventListener('abort', () => this.respond(callId, errorResult('Cancelled by the client')), { once: true });
      const delivered = this.dispatcher ? safeDispatch(this.dispatcher, { callId, tool, args }) : false;
      if (!delivered) this.respond(callId, errorResult('No TexIt project window is available to handle this tool call. Open a project in TexIt and try again.'));
    });
  }
}

function safeDispatch(fn: ToolCallDispatcher, call: McpServerToolCall): boolean {
  try {
    return fn(call);
  } catch {
    return false;
  }
}

/** Tool input schemas must be JSON-schema objects (`type: "object"`). */
export function normalizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} };
  if (schema.type === undefined) return { ...schema, type: 'object' };
  if (schema.type !== 'object') return { type: 'object', properties: {} };
  return schema;
}

export function errorResult(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
