/**
 * Desktop: expose the open project as an MCP server (Streamable HTTP on localhost) so external
 * agents (Claude Code, Codex, Cursor…) can read/edit/compile it. Their activity is logged in an
 * "External agent" thread; when auto-apply is off their edits go through the same review cards.
 */
import type { AgentEvent, ProjectToolDef, ProjectToolsServer } from '@texit/ai';
import { host } from '@/lib/platform';
import { useLayout, useWorkspace } from '@/state/workspace';
import { toast } from '@/ui';
import { loadAi } from './sdk';
import { useAiSettings } from './store';
import { createWorkspaceToolContext } from './projectContext';
import { newThread, openThread, requestReview, uid, updateThread, useChat, type UiMessage } from './chat/store';
import { createApplier } from './chat/runner';

let server: ProjectToolsServer | null = null;
let serving: string | null = null; // `${projectId}|${autoApply}`
let busy = Promise.resolve();
let currentMessage: { threadId: string; id: string; at: number; applier: ReturnType<typeof createApplier> } | null = null;

function externalThreadId(): string | null {
  const s = useChat.getState();
  const existing = s.index.find((t) => t.external);
  if (existing) return existing.id;
  return newThread({ external: true, title: 'External agent', activate: false })?.id ?? null;
}

/** Log an event into the external-agent thread (one assistant message per burst of activity). */
async function log(e: AgentEvent) {
  const threadId = externalThreadId();
  if (!threadId) return;
  if (!useChat.getState().threads[threadId]) await openThreadQuiet(threadId);
  const now = Date.now();
  if (!currentMessage || currentMessage.threadId !== threadId || now - currentMessage.at > 120_000) {
    const msg: UiMessage = { id: uid('x'), role: 'assistant', parts: [], createdAt: now, status: 'done', modelLabel: 'External agent via MCP' };
    updateThread(threadId, (t) => ({ ...t, updatedAt: now, messages: [...t.messages, msg] }));
    currentMessage = { threadId, id: msg.id, at: now, applier: createApplier(threadId, msg.id, msg) };
  }
  currentMessage.at = now;
  currentMessage.applier.apply(e);
  currentMessage.applier.flush();
}

async function openThreadQuiet(id: string) {
  const prev = useChat.getState().activeId;
  await openThread(id);
  if (prev && prev !== id) useChat.setState({ activeId: prev });
}

function wrap(defs: ProjectToolDef[]): ProjectToolDef[] {
  let seq = 0;
  return defs.map((d) => ({
    ...d,
    async execute(args, opts) {
      const id = `ext_${Date.now().toString(36)}_${++seq}`;
      void log({ type: 'tool-call', id, name: d.name, input: args });
      try {
        const out = await d.execute(args, opts);
        void log({ type: 'tool-result', id, name: d.name, output: out });
        return out;
      } catch (err) {
        void log({ type: 'tool-result', id, name: d.name, output: (err as Error).message, isError: true });
        throw err;
      }
    },
  }));
}

async function reconcile() {
  if (!host) return;
  const { exposeMcpServer, autoApplyEdits } = useAiSettings.getState();
  const projectId = useWorkspace.getState().session?.id ?? null;
  const want = exposeMcpServer && projectId ? `${projectId}|${autoApplyEdits}` : null;
  if (want === serving) return;
  if (!want) {
    server?.dispose();
    server = null;
    serving = null;
    try {
      // Keep the server alive while a project is closed only if the user still wants it.
      if (!exposeMcpServer) await host.mcp.stopServer();
      else await host.mcp.setServerTools([]);
    } catch {
      /* ignore */
    }
    return;
  }
  const ai = await loadAi();
  const ctx = createWorkspaceToolContext({
    reviewEdit: autoApplyEdits
      ? undefined
      : (path, _before, after) => {
          const threadId = externalThreadId();
          if (!threadId) return Promise.resolve(false);
          toast('An external agent proposed an edit', {
            description: path,
            action: {
              label: 'Review',
              onClick: () => {
                useLayout.getState().set({ aiOpen: true });
                void openThread(threadId);
              },
            },
          });
          return requestReview(threadId, path, after);
        },
    confirm: !autoApplyEdits,
  });
  const defs = wrap(ai.createProjectToolDefs(ctx, { autoApply: autoApplyEdits, onEvent: (e) => void log(e) }));
  try {
    if (server) await server.update(defs);
    else server = await ai.serveProjectTools(host, defs, { start: true });
    serving = want;
  } catch (err) {
    toast.error('Could not start the TexIt MCP server', { description: (err as Error).message });
    useAiSettings.getState().set({ exposeMcpServer: false });
  }
}

export function startMcpServerWiring(): () => void {
  if (!host) return () => {};
  const run = () => {
    busy = busy.then(reconcile, reconcile);
  };
  const unsubs = [
    useAiSettings.subscribe((s, p) => {
      if (s.exposeMcpServer !== p.exposeMcpServer || s.autoApplyEdits !== p.autoApplyEdits) run();
    }),
    useWorkspace.subscribe((s, p) => {
      if (s.session?.id !== p.session?.id) run();
    }),
  ];
  run();
  return () => {
    unsubs.forEach((u) => u());
    server?.dispose();
    server = null;
    serving = null;
  };
}
