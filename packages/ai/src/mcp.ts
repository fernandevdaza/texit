/**
 * MCP client manager: connects to the user's configured MCP servers and exposes their tools
 * to the agent as one prefixed AI SDK ToolSet (`mcp__<server>__<tool>`).
 *
 * Transports:
 *  - `http` (Streamable HTTP) and `sse`: `@ai-sdk/mcp`'s built-in fetch-based transports (browser-safe;
 *    the remote server must allow CORS from TexIt's origin).
 *  - `stdio`: desktop only, through `host.mcp.startStdio/send/onMessage` (`HostMcpStdioTransport`).
 */
import { createMCPClient, type JSONRPCMessage, type MCPClient, type MCPClientConfig, type MCPTransport } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { getHost, type JsonRpcMessage, type McpStdioConfig, type TexitHost } from '@texit/core';
import { sanitizeToolName } from './tools';
import type { McpServerConfig } from './types';

export type McpServerState = 'disabled' | 'connecting' | 'connected' | 'error';

export interface McpServerStatus {
  id: string;
  name: string;
  transport: McpServerConfig['transport'];
  state: McpServerState;
  toolCount: number;
  /** Qualified tool names (as seen by the model). */
  tools: string[];
  error?: string;
  /** Server-provided usage instructions, if any. */
  instructions?: string;
  serverInfo?: { name: string; version: string };
}

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  /** Tool name on the server. */
  name: string;
  /** Name exposed to the model: `mcp__<server>__<tool>`. */
  qualifiedName: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpManagerOptions {
  /** Desktop host for stdio servers. Defaults to `getHost()`. Pass `null` to disable stdio. */
  host?: Pick<TexitHost, 'mcp'> | null;
  clientName?: string;
  clientVersion?: string;
  /** Initialisation timeout per server (ms). Default 20 s. */
  connectTimeoutMs?: number;
  /** Override client creation (tests / custom transports). */
  createClient?: (config: MCPClientConfig) => Promise<MCPClient>;
}

// ─────────────────────────── stdio transport over the host bridge ───────────────────────────

/** `MCPTransport` that talks to a stdio MCP server spawned by the desktop host. */
export class HostMcpStdioTransport implements MCPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private unsubs: (() => void)[] = [];
  private started = false;
  private closed = false;

  constructor(
    private readonly host: Pick<TexitHost, 'mcp'>,
    private readonly config: McpStdioConfig,
    private readonly hooks: { onExit?: (info: { code: number | null; stderr: string }) => void } = {},
  ) {}

  get processId(): string {
    return this.config.id;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('HostMcpStdioTransport already started');
    this.started = true;
    const { mcp } = this.host;
    this.unsubs.push(
      mcp.onMessage(this.config.id, (msg) => {
        try {
          this.onmessage?.(msg as unknown as JSONRPCMessage);
        } catch (e) {
          this.onerror?.(e as Error);
        }
      }),
      mcp.onExit(this.config.id, (info) => {
        if (this.closed) return;
        this.closed = true;
        this.hooks.onExit?.(info);
        const tail = info.stderr?.trim().split(/\r?\n/).slice(-5).join('\n');
        this.onerror?.(new Error(`MCP server exited (code ${info.code ?? 'null'})${tail ? `: ${tail}` : ''}`));
        this.cleanup();
        this.onclose?.();
      }),
    );
    try {
      await mcp.startStdio(this.config);
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('MCP stdio transport is closed');
    await this.host.mcp.send(this.config.id, message as unknown as JsonRpcMessage);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    try {
      await this.host.mcp.stop(this.config.id);
    } catch {
      /* already gone */
    }
    this.onclose?.();
  }

  private cleanup() {
    for (const u of this.unsubs.splice(0)) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  }
}

// ─────────────────────────── Manager ───────────────────────────

interface Entry {
  config: McpServerConfig;
  key: string;
  slug: string;
  generation: number;
  state: McpServerState;
  error?: string;
  client?: MCPClient;
  tools: ToolSet;
  infos: McpToolInfo[];
  instructions?: string;
  serverInfo?: { name: string; version: string };
  pending?: Promise<void>;
}

function configKey(c: McpServerConfig): string {
  return JSON.stringify([c.enabled, c.transport, c.url, c.headers, c.command, c.args, c.env, c.name]);
}

function slugify(s: string): string {
  return sanitizeToolName(s.toLowerCase(), 24).replace(/-/g, '_');
}

/** `mcp__<server>__<tool>`, ≤ 64 chars, provider-safe. */
export function qualifyMcpToolName(serverSlug: string, tool: string): string {
  return sanitizeToolName(`mcp__${serverSlug}__${tool}`, 64);
}

let stdioSeq = 0;

export class McpManager {
  private entries = new Map<string, Entry>();
  private listeners = new Set<(statuses: McpServerStatus[]) => void>();
  private disposed = false;
  private generationSeq = 0;

  constructor(private readonly opts: McpManagerOptions = {}) {}

  /**
   * Reconcile with the given server list: connects new/changed enabled servers, closes removed,
   * disabled or changed ones. Resolves when every connection attempt has settled (never rejects;
   * failures are reported through `status()`).
   */
  async connect(configs: McpServerConfig[]): Promise<void> {
    if (this.disposed) throw new Error('McpManager is closed');
    const wanted = new Map(configs.map((c) => [c.id, c]));
    const closing: Promise<void>[] = [];
    for (const [id, entry] of this.entries) {
      const next = wanted.get(id);
      if (!next || configKey(next) !== entry.key) {
        closing.push(this.closeEntry(entry));
        this.entries.delete(id);
      }
    }
    const starting: Promise<void>[] = [];
    for (const config of configs) {
      if (this.entries.has(config.id)) continue;
      const entry: Entry = {
        config,
        key: configKey(config),
        slug: this.uniqueSlug(config),
        generation: ++this.generationSeq,
        state: config.enabled ? 'connecting' : 'disabled',
        tools: {},
        infos: [],
      };
      this.entries.set(config.id, entry);
      if (config.enabled) starting.push((entry.pending = this.open(entry)));
    }
    this.notify();
    await Promise.allSettled([...closing, ...starting]);
  }

  /** Reconnect one server (e.g. after an error). */
  async reconnect(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || !entry.config.enabled) return;
    await this.closeEntry(entry);
    entry.generation = ++this.generationSeq;
    entry.state = 'connecting';
    entry.error = undefined;
    entry.tools = {};
    entry.infos = [];
    this.notify();
    await (entry.pending = this.open(entry));
  }

  /** Re-fetch the tool list of a connected server (or all). */
  async refreshTools(id?: string): Promise<void> {
    const targets = id ? [this.entries.get(id)].filter(Boolean) as Entry[] : [...this.entries.values()];
    await Promise.allSettled(
      targets.filter((e) => e.state === 'connected' && e.client).map(async (e) => {
        try {
          await this.loadTools(e, e.client!);
        } catch (err) {
          e.state = 'error';
          e.error = errorMessage(err);
        }
      }),
    );
    this.notify();
  }

  status(): McpServerStatus[] {
    return [...this.entries.values()].map((e) => ({
      id: e.config.id,
      name: e.config.name,
      transport: e.config.transport,
      state: e.state,
      toolCount: e.infos.length,
      tools: e.infos.map((t) => t.qualifiedName),
      ...(e.error ? { error: e.error } : {}),
      ...(e.instructions ? { instructions: e.instructions } : {}),
      ...(e.serverInfo ? { serverInfo: e.serverInfo } : {}),
    }));
  }

  /** Merged ToolSet of all connected servers, keyed by qualified name. */
  getTools(): ToolSet {
    const out: ToolSet = {};
    for (const e of this.entries.values()) if (e.state === 'connected') Object.assign(out, e.tools);
    return out;
  }

  listTools(): McpToolInfo[] {
    return [...this.entries.values()].filter((e) => e.state === 'connected').flatMap((e) => e.infos);
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(cb: (statuses: McpServerStatus[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Disconnect everything. The manager cannot be reused afterwards. */
  async close(): Promise<void> {
    this.disposed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map((e) => this.closeEntry(e)));
    this.notify();
    this.listeners.clear();
  }

  // ── internals ──

  private notify() {
    const s = this.status();
    for (const l of this.listeners) {
      try {
        l(s);
      } catch {
        /* ignore */
      }
    }
  }

  private uniqueSlug(config: McpServerConfig): string {
    const base = slugify(config.name || config.id) || 'server';
    const taken = new Set([...this.entries.values()].map((e) => e.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }

  private host(): Pick<TexitHost, 'mcp'> | undefined {
    if (this.opts.host === null) return undefined;
    return this.opts.host ?? getHost();
  }

  private transportFor(entry: Entry): MCPClientConfig['transport'] {
    const c = entry.config;
    if (c.transport === 'http' || c.transport === 'sse') {
      if (!c.url) throw new Error('No URL configured.');
      return { type: c.transport, url: c.url, headers: c.headers };
    }
    const host = this.host();
    if (!host) throw new Error('stdio MCP servers are only available in the desktop app.');
    if (!c.command) throw new Error('No command configured.');
    const generation = entry.generation;
    return new HostMcpStdioTransport(
      host,
      { id: `mcp-${c.id}-${++stdioSeq}`, command: c.command, args: c.args, env: c.env },
      {
        onExit: (info) => {
          if (entry.generation !== generation || this.entries.get(c.id) !== entry) return;
          const tail = info.stderr?.trim().split(/\r?\n/).slice(-3).join(' ');
          entry.state = 'error';
          entry.error = `Server exited (code ${info.code ?? 'null'})${tail ? `: ${tail}` : ''}`;
          entry.client = undefined;
          entry.tools = {};
          entry.infos = [];
          this.notify();
        },
      },
    );
  }

  private async open(entry: Entry): Promise<void> {
    const generation = entry.generation;
    const stale = () => this.disposed || entry.generation !== generation || this.entries.get(entry.config.id) !== entry;
    let client: MCPClient | undefined;
    try {
      const transport = this.transportFor(entry);
      const config: MCPClientConfig = {
        transport,
        clientName: this.opts.clientName ?? 'TexIt',
        version: this.opts.clientVersion ?? '0.1.0',
        initializationOptions: { timeout: this.opts.connectTimeoutMs ?? 20_000 },
        onUncaughtError: (err) => {
          if (stale()) return;
          // Non-fatal transport errors (e.g. a dropped SSE stream) — surface without disconnecting.
          entry.error = errorMessage(err);
          this.notify();
        },
      };
      client = await (this.opts.createClient ?? createMCPClient)(config);
      if (stale()) {
        await client.close().catch(() => {});
        return;
      }
      entry.client = client;
      entry.instructions = client.instructions;
      const info = client.serverInfo as { name?: string; version?: string } | undefined;
      if (info?.name) entry.serverInfo = { name: info.name, version: info.version ?? '' };
      await this.loadTools(entry, client);
      if (stale()) return;
      entry.state = 'connected';
      entry.error = undefined;
    } catch (err) {
      if (client) await client.close().catch(() => {});
      if (stale()) return;
      entry.client = undefined;
      entry.state = 'error';
      entry.error = errorMessage(err);
      entry.tools = {};
      entry.infos = [];
    } finally {
      if (!stale()) this.notify();
    }
  }

  private async loadTools(entry: Entry, client: MCPClient): Promise<void> {
    const first = await client.listTools();
    const all = [...first.tools];
    let cursor = first.nextCursor;
    for (let page = 0; cursor && page < 20; page++) {
      const next = await client.listTools({ params: { cursor } });
      all.push(...next.tools);
      cursor = next.nextCursor;
    }
    const raw = client.toolsFromDefinitions({ ...first, tools: all, nextCursor: undefined }) as ToolSet;
    const tools: ToolSet = {};
    const infos: McpToolInfo[] = [];
    for (const def of all) {
      const t = raw[def.name];
      if (!t) continue;
      let qualified = qualifyMcpToolName(entry.slug, def.name);
      for (let i = 2; tools[qualified]; i++) qualified = qualifyMcpToolName(entry.slug, `${def.name}_${i}`);
      tools[qualified] = t;
      infos.push({
        serverId: entry.config.id,
        serverName: entry.config.name,
        name: def.name,
        qualifiedName: qualified,
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema as Record<string, unknown>,
      });
    }
    entry.tools = tools;
    entry.infos = infos;
  }

  private async closeEntry(entry: Entry): Promise<void> {
    entry.generation = ++this.generationSeq; // invalidate in-flight opens
    const client = entry.client;
    entry.client = undefined;
    entry.tools = {};
    entry.infos = [];
    if (client) await client.close().catch(() => {});
  }
}

function errorMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  const msg = e?.message ?? String(err);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return `${msg} — the server is unreachable or does not allow requests from this origin (CORS).`;
  }
  return e?.cause?.message && !msg.includes(e.cause.message) ? `${msg}: ${e.cause.message}` : msg;
}
