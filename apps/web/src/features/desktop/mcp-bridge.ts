/**
 * McpServerBridge — exposes renderer-side tools through TexIt's local MCP
 * server (Streamable HTTP on 127.0.0.1, run by the desktop main process) so
 * external agents (Claude Code, Codex, Cursor…) can read/edit/compile the open
 * project. Tool calls are executed here, against the live Y.Doc.
 *
 * The tool definitions come from the AI package (`createProjectToolDefs(ctx)`),
 * passed in by the caller.
 */
import { getHost, type McpServerInfo, type McpServerToolCall, type TexitHost } from '@texit/core';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: any): Promise<string>;
}

export interface McpServerBridgeOptions {
  host?: TexitHost;
  /** Start the HTTP server if it is not running (default true). */
  autoStart?: boolean;
  port?: number;
  /** Max characters returned per tool result (default 200k). */
  maxResultChars?: number;
  onCall?: (call: McpServerToolCall, outcome: { ok: boolean; ms: number }) => void;
}

export class McpServerBridge {
  private readonly host: TexitHost;
  private tools = new Map<string, McpToolDef>();
  private unsubscribe: (() => void) | null = null;
  private readonly opts: McpServerBridgeOptions;

  constructor(tools: McpToolDef[], opts: McpServerBridgeOptions = {}) {
    const host = opts.host ?? getHost();
    if (!host) throw new Error('McpServerBridge requires the TexIt desktop app');
    this.host = host;
    this.opts = opts;
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Publish the tools, subscribe to calls and (optionally) start the server. */
  async start(): Promise<McpServerInfo> {
    if (!this.unsubscribe) this.unsubscribe = this.host.mcp.onServerToolCall((call) => void this.handle(call));
    await this.publish();
    const info = await this.host.mcp.serverInfo();
    if (info.running || this.opts.autoStart === false) return info;
    return this.host.mcp.startServer(this.opts.port !== undefined ? { port: this.opts.port } : undefined);
  }

  /** Replace the tool set (e.g. when another project is opened). */
  async setTools(tools: McpToolDef[]): Promise<void> {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    if (this.unsubscribe) await this.publish();
  }

  /** Stop answering calls. Pass `stopServer` to also shut the HTTP server down. */
  async stop(opts: { stopServer?: boolean } = {}): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.host.mcp.setServerTools([]).catch(() => undefined);
    if (opts.stopServer) await this.host.mcp.stopServer();
  }

  info(): Promise<McpServerInfo> {
    return this.host.mcp.serverInfo();
  }

  private publish(): Promise<void> {
    return this.host.mcp.setServerTools([...this.tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
  }

  private async handle(call: McpServerToolCall): Promise<void> {
    const started = performance.now();
    const tool = this.tools.get(call.tool);
    let text: string;
    let isError = false;
    if (!tool) {
      text = `Unknown tool: ${call.tool}`;
      isError = true;
    } else {
      try {
        text = await tool.execute(call.args ?? {});
      } catch (err) {
        text = err instanceof Error ? err.message : String(err);
        isError = true;
      }
    }
    const max = this.opts.maxResultChars ?? 200_000;
    if (text.length > max) text = `${text.slice(0, max)}\n… (truncated ${text.length - max} characters)`;
    await this.host.mcp.respondToolCall(call.callId, { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) }).catch(() => undefined);
    this.opts.onCall?.(call, { ok: !isError, ms: Math.round(performance.now() - started) });
  }
}
