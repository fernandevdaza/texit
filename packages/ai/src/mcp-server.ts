/**
 * Expose the open project as an MCP server (desktop): the host runs a Streamable HTTP server on
 * localhost and forwards `tools/call` requests to the renderer, which executes them here.
 */
import type { McpServerInfo, TexitHost } from '@texit/core';
import { callProjectToolDef, type ProjectToolDef } from './tools';

export interface ServeProjectToolsOptions {
  /** Also start the HTTP server (`host.mcp.startServer`). Default false (only registers tools). */
  start?: boolean;
  port?: number;
}

export interface ProjectToolsServer {
  /** Server info when `start` was requested. */
  info?: McpServerInfo;
  /** Replace the exposed tools (e.g. after switching projects). */
  update(defs: readonly ProjectToolDef[]): Promise<void>;
  /** Stop answering tool calls (does not stop the HTTP server). */
  dispose(): void;
}

/**
 * Register `defs` (from `createProjectToolDefs(ctx)`) with the host's MCP server and answer
 * incoming tool calls. Unknown tools and tool failures are answered with `isError: true`.
 */
export async function serveProjectTools(
  host: Pick<TexitHost, 'mcp'>,
  defs: readonly ProjectToolDef[],
  opts: ServeProjectToolsOptions = {},
): Promise<ProjectToolsServer> {
  let current = defs;
  const publish = (d: readonly ProjectToolDef[]) =>
    host.mcp.setServerTools(d.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));

  await publish(current);
  const off = host.mcp.onServerToolCall((call) => {
    void (async () => {
      const result = await callProjectToolDef(current, call.tool, call.args);
      try {
        await host.mcp.respondToolCall(call.callId, result);
      } catch {
        /* the caller may have gone away */
      }
    })();
  });
  const info = opts.start ? await host.mcp.startServer(opts.port != null ? { port: opts.port } : undefined) : undefined;
  return {
    info,
    async update(next) {
      current = next;
      await publish(next);
    },
    dispose: off,
  };
}
