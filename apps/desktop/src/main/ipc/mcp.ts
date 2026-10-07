import { app, type WebContents } from 'electron';
import { z } from 'zod';
import type { JsonRpcMessage } from '@texit/core';
import { Events, Invoke, Stream } from '../../shared/ipc';
import { TexitMcpServer } from '../mcp/server';
import { clientConfigSnippets } from '../mcp/snippets';
import { sendStdio, startStdio, stopAllStdio, stopStdio } from '../mcp/stdio';
import { paths } from '../paths';
import { handle, safeSend, zAbsPath, zId, zStringRecord } from './util';

let server: TexitMcpServer | null = null;
/** Renderer that executes tool calls (the last one that published tools or subscribed). */
let toolOwner: WebContents | null = null;

export function getMcpServer(): TexitMcpServer {
  if (!server) {
    server = new TexitMcpServer({ tokenFile: paths.mcpToken(), version: app.getVersion() });
    server.setDispatcher((call) => safeSend(toolOwner, Events.mcpServerToolCall, call));
  }
  return server;
}

function setToolOwner(wc: WebContents) {
  if (toolOwner === wc) return;
  toolOwner = wc;
  wc.once('destroyed', () => {
    if (toolOwner === wc) toolOwner = null;
  });
}

export async function shutdownMcp(): Promise<void> {
  await stopAllStdio();
  await server?.stop();
}

const zJsonRpc = z.looseObject({ jsonrpc: z.literal('2.0') });

const zTool = z.object({
  name: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/, 'invalid tool name'),
  description: z.string().max(10_000),
  inputSchema: z.record(z.string(), z.unknown()),
});

export function registerMcpIpc(): void {
  // ── stdio servers ──
  handle(
    Invoke.mcpStartStdio,
    z.tuple([
      z.object({
        id: zId,
        command: z.string().min(1).max(4096),
        args: z.array(z.string().max(32_768)).max(256).optional(),
        env: zStringRecord.optional(),
        cwd: zAbsPath.optional(),
      }),
    ]),
    async (event, cfg) => {
      const owner = event.sender;
      await startStdio(cfg, {
        onMessage: (msg) => safeSend(owner, Stream.mcpMessage(cfg.id), msg),
        onExit: (info) => safeSend(owner, Stream.mcpExit(cfg.id), info),
      });
      owner.once('destroyed', () => void stopStdio(cfg.id));
    },
  );
  handle(Invoke.mcpSend, z.tuple([zId, zJsonRpc]), (_e, id, msg) => sendStdio(id, msg as JsonRpcMessage));
  handle(Invoke.mcpStop, z.tuple([zId]), (_e, id) => stopStdio(id));

  // ── TexIt MCP server ──
  handle(Invoke.mcpServerInfo, z.tuple([]), () => getMcpServer().info());
  handle(Invoke.mcpStartServer, z.tuple([z.object({ port: z.number().int().min(0).max(65535).optional() }).optional()]), (event, opts) => {
    setToolOwner(event.sender);
    return getMcpServer().start(opts ?? {});
  });
  handle(Invoke.mcpStopServer, z.tuple([]), () => getMcpServer().stop());
  handle(Invoke.mcpSetServerTools, z.tuple([z.array(zTool).max(512)]), (event, tools) => {
    setToolOwner(event.sender);
    getMcpServer().setTools(tools);
  });
  handle(Invoke.mcpAttachToolCalls, z.tuple([]), (event) => {
    setToolOwner(event.sender);
  });
  handle(
    Invoke.mcpRespondToolCall,
    z.tuple([
      z.string().uuid(),
      z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })), isError: z.boolean().optional() }),
    ]),
    (_e, callId, result) => getMcpServer().respond(callId, result),
  );
  handle(Invoke.mcpClientConfigSnippets, z.tuple([]), async () => {
    const s = getMcpServer();
    const info = s.info().running ? s.info() : await s.start();
    return clientConfigSnippets({ url: info.url!, token: info.token! });
  });
}
