/**
 * Persisted AI settings (localStorage `texit:ai`). Contains NO secrets — API keys
 * and MCP credentials live in `secrets.ts`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelRef, ProviderKind } from '@texit/ai';

export const DEV_MOCK_KIND = 'dev-mock' as const;
export type WebProviderKind = ProviderKind | typeof DEV_MOCK_KIND;

export interface ProviderEntry {
  id: string;
  kind: WebProviderKind;
  name: string;
  enabled: boolean;
  baseURL?: string;
  /** kind 'cli': codex | claude | gemini | opencode */
  cliAgent?: string;
  models: string[];
  defaultModel?: string;
  lastTest?: { ok: boolean; message: string; latencyMs: number; at: number };
}

export interface McpEntry {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export type AgentMode = 'agent' | 'ask';

export interface AiSettingsState {
  providers: ProviderEntry[];
  chatModel?: ModelRef;
  completionModel?: ModelRef;
  inlineCompletions: boolean;
  autoApplyEdits: boolean;
  customInstructions: string;
  mcpServers: McpEntry[];
  exposeMcpServer: boolean;
  mode: AgentMode;

  addProvider(p: ProviderEntry): void;
  updateProvider(id: string, patch: Partial<ProviderEntry>): void;
  removeProvider(id: string): void;
  addMcpServer(s: McpEntry): void;
  updateMcpServer(id: string, patch: Partial<McpEntry>): void;
  removeMcpServer(id: string): void;
  set(patch: Partial<Omit<AiSettingsState, 'providers' | 'mcpServers'>>): void;
}

function firstModelRef(p: ProviderEntry): ModelRef | undefined {
  const modelId = p.defaultModel ?? p.models[0];
  return modelId ? { providerId: p.id, modelId } : undefined;
}

export const useAiSettings = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      providers: [],
      chatModel: undefined,
      completionModel: undefined,
      inlineCompletions: false,
      autoApplyEdits: false,
      customInstructions: '',
      mcpServers: [],
      exposeMcpServer: false,
      mode: 'agent',

      addProvider(p) {
        const s = get();
        set({
          providers: [...s.providers, p],
          chatModel: s.chatModel && s.providers.some((x) => x.id === s.chatModel!.providerId) ? s.chatModel : firstModelRef(p),
        });
      },
      updateProvider(id, patch) {
        set({ providers: get().providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      },
      removeProvider(id) {
        const s = get();
        const providers = s.providers.filter((p) => p.id !== id);
        const fallback = providers.find((p) => p.enabled);
        set({
          providers,
          chatModel: s.chatModel?.providerId === id ? (fallback ? firstModelRef(fallback) : undefined) : s.chatModel,
          completionModel: s.completionModel?.providerId === id ? undefined : s.completionModel,
        });
      },
      addMcpServer(srv) {
        set({ mcpServers: [...get().mcpServers, srv] });
      },
      updateMcpServer(id, patch) {
        set({ mcpServers: get().mcpServers.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
      },
      removeMcpServer(id) {
        set({ mcpServers: get().mcpServers.filter((m) => m.id !== id) });
      },
      set: (patch) => set(patch),
    }),
    {
      name: 'texit:ai',
      version: 1,
      // Never persist the dev mock provider into production builds' storage semantics.
      partialize: (s) => ({
        providers: s.providers,
        chatModel: s.chatModel,
        completionModel: s.completionModel,
        inlineCompletions: s.inlineCompletions,
        autoApplyEdits: s.autoApplyEdits,
        customInstructions: s.customInstructions,
        mcpServers: s.mcpServers,
        exposeMcpServer: s.exposeMcpServer,
        mode: s.mode,
      }),
    },
  ),
);

export const aiSettings = () => useAiSettings.getState();

export function findProvider(id: string | undefined): ProviderEntry | undefined {
  return id ? useAiSettings.getState().providers.find((p) => p.id === id) : undefined;
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
