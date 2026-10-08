/**
 * Non-React AI runtime: resolves configured models, keeps plugin tools and the MCP
 * client manager. Loads @texit/ai lazily.
 */
import { create } from 'zustand';
import type { AiModel, McpManager, McpServerConfig, McpServerStatus, ModelRef, ProviderConfig, ProviderKind } from '@texit/ai';
import type { AIToolDef } from '@texit/plugin-api';
import type { Disposable } from '@texit/core';
import { host } from '@/lib/platform';
import { t } from '@/lib/i18n';
import { loadAi } from './sdk';
import { getSecret, getSecretJson, loadSecrets, secretKeys } from './secrets';
import { DEV_MOCK_KIND, findProvider, useAiSettings, type McpEntry, type ProviderEntry } from './store';

export const DEV = import.meta.env.DEV;

// ─────────────────────────── providers / models ───────────────────────────

const KEYLESS: WebKinds[] = ['ollama', 'lmstudio', 'openai-compatible', 'cli', DEV_MOCK_KIND];
type WebKinds = ProviderEntry['kind'];

export function needsKey(p: ProviderEntry): boolean {
  return !KEYLESS.includes(p.kind);
}

export function hasKey(p: ProviderEntry): boolean {
  return !!getSecret(secretKeys.apiKey(p.id));
}

/** Provider is usable (enabled + credentials / environment). */
export function providerReady(p: ProviderEntry | undefined): boolean {
  if (!p || !p.enabled) return false;
  if (p.kind === DEV_MOCK_KIND) return DEV;
  if (p.kind === 'cli') return !!host;
  return !needsKey(p) || hasKey(p);
}

export function toProviderConfig(p: ProviderEntry): ProviderConfig {
  return {
    id: p.id,
    kind: p.kind as ProviderKind,
    name: p.name,
    enabled: p.enabled,
    baseURL: p.baseURL,
    apiKey: getSecret(secretKeys.apiKey(p.id)),
    cliAgent: p.cliAgent,
    models: p.models,
    defaultModel: p.defaultModel,
  };
}

export interface ResolvedModel {
  provider: ProviderEntry;
  modelId: string;
  /** AI SDK model; null for CLI agents. */
  model: AiModel | null;
}

export async function resolveModel(ref: ModelRef | undefined): Promise<ResolvedModel> {
  const provider = findProvider(ref?.providerId);
  if (!ref || !provider) throw new Error(t('ai.err.noModel'));
  if (!provider.enabled) throw new Error(t('ai.err.providerDisabled', { name: provider.name }));
  if (provider.kind === DEV_MOCK_KIND) {
    if (!DEV) throw new Error(t('ai.err.mockDevOnly'));
    const { createMockModel } = await import('./dev/mockModel');
    return { provider, modelId: ref.modelId, model: createMockModel(ref.modelId) };
  }
  if (provider.kind === 'cli') {
    if (!host) throw new Error(t('ai.err.cliDesktopOnly'));
    return { provider, modelId: ref.modelId, model: null };
  }
  await ensureSecrets();
  if (needsKey(provider) && !hasKey(provider)) throw new Error(t('ai.err.missingKey', { name: provider.name }));
  const ai = await loadAi();
  return { provider, modelId: ref.modelId, model: ai.createLanguageModel(toProviderConfig(provider), ref.modelId) };
}

export function chatModelRef(): ModelRef | undefined {
  return useAiSettings.getState().chatModel;
}

/** Fast model for inline features (falls back to the chat model, but never a CLI agent). */
export function completionModelRef(): ModelRef | undefined {
  const s = useAiSettings.getState();
  const ref = s.completionModel ?? s.chatModel;
  return findProvider(ref?.providerId)?.kind === 'cli' ? undefined : ref;
}

export function isConfigured(): boolean {
  const ref = chatModelRef();
  return !!ref && providerReady(findProvider(ref.providerId));
}

let secretsPromise: Promise<void> | null = null;
/** Desktop: make sure provider/MCP secrets are loaded from the keychain. */
export function ensureSecrets(): Promise<void> {
  if (!host) return Promise.resolve();
  const s = useAiSettings.getState();
  const keys = [
    ...s.providers.map((p) => secretKeys.apiKey(p.id)),
    ...s.mcpServers.flatMap((m) => [secretKeys.mcpHeaders(m.id), secretKeys.mcpEnv(m.id)]),
  ];
  secretsPromise = (secretsPromise ?? Promise.resolve()).then(() => loadSecrets(keys));
  return secretsPromise;
}

export function modelLabel(ref: ModelRef | undefined): string {
  if (!ref) return t('ai.noModel');
  return ref.modelId;
}

// ─────────────────────────── plugin tools ───────────────────────────

const pluginTools = new Map<string, AIToolDef>();

export function registerPluginTool(tool: AIToolDef): Disposable {
  pluginTools.set(tool.name, tool);
  return {
    dispose() {
      if (pluginTools.get(tool.name) === tool) pluginTools.delete(tool.name);
    },
  };
}

export function getPluginTools(): AIToolDef[] {
  return [...pluginTools.values()];
}

// ─────────────────────────── MCP client manager ───────────────────────────

export const useMcpStatus = create<{ statuses: McpServerStatus[] }>(() => ({ statuses: [] }));

let manager: McpManager | null = null;
let managerPromise: Promise<McpManager> | null = null;

export function mcpConfig(m: McpEntry): McpServerConfig {
  return {
    id: m.id,
    name: m.name,
    enabled: m.enabled && (m.transport !== 'stdio' || !!host),
    transport: m.transport,
    url: m.url,
    command: m.command,
    args: m.args,
    headers: getSecretJson<Record<string, string>>(secretKeys.mcpHeaders(m.id)),
    env: getSecretJson<Record<string, string>>(secretKeys.mcpEnv(m.id)),
  };
}

async function getManager(): Promise<McpManager> {
  if (manager) return manager;
  managerPromise ??= loadAi().then((ai) => {
    manager = new ai.McpManager({ host: host ?? null, clientName: 'TexIt' });
    manager.onStatusChange((statuses) => useMcpStatus.setState({ statuses }));
    return manager;
  });
  return managerPromise;
}

/** Connect / reconcile MCP servers with the settings. Cheap no-op when none are configured. */
export async function syncMcpServers(): Promise<void> {
  const servers = useAiSettings.getState().mcpServers;
  if (!servers.length && !manager) return;
  await ensureSecrets();
  const m = await getManager();
  await m.connect(servers.map(mcpConfig));
}

export async function reconnectMcp(id: string): Promise<void> {
  const m = await getManager();
  await m.reconnect(id);
}

/** Connected MCP tools (empty if none). */
export async function getMcpTools() {
  const servers = useAiSettings.getState().mcpServers.filter((s) => s.enabled);
  if (!servers.length) return {};
  if (!manager) await syncMcpServers();
  return manager?.getTools() ?? {};
}

export function getMcpInstructions(): string {
  return useMcpStatus
    .getState()
    .statuses.filter((s) => s.state === 'connected')
    .map((s) => `${s.name} (tools prefixed mcp__…): ${s.instructions ?? `${s.toolCount} tools`}`)
    .join('\n');
}
