import { z } from 'zod';
import { Invoke, Stream } from '../../shared/ipc';
import { cancelAgentRun, runAgent } from '../agents/run';
import { detectAgents } from '../agents/registry';
import { handle, safeSend, zAbsPath, zId, zStringRecord } from './util';

const zRunRequest = z.object({
  runId: zId,
  agent: z.enum(['codex', 'claude', 'gemini', 'opencode', 'aider', 'qwen']),
  prompt: z.string().min(1).max(2_000_000),
  cwd: zAbsPath,
  model: z.string().max(200).regex(/^[\w.:/@[\]-]+$/, 'invalid model name').optional(),
  sessionId: z.string().max(200).regex(/^[\w.:-]+$/, 'invalid session id').optional(),
  autoApprove: z.boolean().optional(),
  mcpServers: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        url: z.string().url().max(2048).refine((u) => /^https?:\/\//.test(u), 'must be http(s)'),
        headers: zStringRecord.optional(),
      }),
    )
    .max(16)
    .optional(),
  env: zStringRecord.optional(),
});

export function registerAgentsIpc(): void {
  handle(Invoke.agentsDetect, z.tuple([]), () => detectAgents(true));

  handle(Invoke.agentsRun, z.tuple([zRunRequest]), (event, req) => {
    const channel = Stream.agentEvent(req.runId);
    const owner = event.sender;
    const onDestroyed = () => void cancelAgentRun(req.runId);
    owner.once('destroyed', onDestroyed);
    return runAgent(req, (e) => {
      if (!safeSend(owner, channel, e)) void cancelAgentRun(req.runId);
    }).finally(() => owner.off('destroyed', onDestroyed));
  });

  handle(Invoke.agentsCancel, z.tuple([zId]), (_e, runId) => cancelAgentRun(runId));
}
