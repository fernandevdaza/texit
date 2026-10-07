/**
 * Provider catalog, model factory, model listing and connection testing.
 *
 * Everything here runs in the browser. Requests go straight from the renderer to the
 * provider (bring-your-own-key); see each preset's `browser` / `browserNote` for CORS caveats.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel } from 'ai';
import type { AISettings, ListedModel, ModelRef, ProviderConfig, ProviderKind, ProviderPreset } from './types';

/** A concrete (non-string) AI SDK language model. */
export type AiModel = Exclude<LanguageModel, string>;

export type FetchFn = typeof globalThis.fetch;

const ANTHROPIC_VERSION = '2023-06-01';

// ─────────────────────────── Catalog ───────────────────────────

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    kind: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models via the Anthropic API.',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.claude.com/en/docs/about-claude/models/overview',
    suggestedModels: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tags: ['flagship', 'coding'] },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tags: ['balanced', 'coding'] },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tags: ['fast'] },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', tags: ['most capable'] },
    ],
    defaultModel: 'claude-opus-5-5',
    completionModel: 'claude-haiku-4-5',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
    browserNote: 'Works from the browser (TexIt sends the `anthropic-dangerous-direct-browser-access` header). Your key is visible to this page only.',
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    description: 'GPT models via the OpenAI API (Responses API).',
    defaultBaseURL: 'https://api.openai.com/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://developers.openai.com/api/docs/models',
    suggestedModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tags: ['balanced', 'coding'] },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', tags: ['flagship'] },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol', tags: ['coding'] },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', tags: ['fast'] },
    ],
    defaultModel: 'gpt-6.1-sol',
    completionModel: 'gpt-6-luna',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'google',
    label: 'Google Gemini',
    description: 'Gemini models via the Gemini API (Google AI Studio key).',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    suggestedModels: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tags: ['balanced'] },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', tags: ['flagship'] },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tags: ['fast'] },
      { id: 'gemini-flash-latest', label: 'Gemini Flash (latest alias)' },
    ],
    defaultModel: 'gemini-3.8-flash',
    completionModel: 'gemini-3.5-flash-lite',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    description: 'Hundreds of models from many vendors through one key.',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    docsUrl: 'https://openrouter.ai/models',
    suggestedModels: [
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', tags: ['flagship', 'coding'] },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', tags: ['balanced'] },
      { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', tags: ['balanced'] },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', tags: ['fast'] },
      { id: 'x-ai/grok-4.7', label: 'Grok 4.7' },
      { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', tags: ['cheap'] },
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', tags: ['fast'] },
    ],
    defaultModel: 'anthropic/claude-opus-5.5',
    completionModel: 'anthropic/claude-haiku-4.5',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'groq',
    label: 'Groq',
    description: 'Very fast inference of open-weight models.',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/models',
    suggestedModels: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', tags: ['balanced'] },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', tags: ['fast'] },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (preview)' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    ],
    defaultModel: 'openai/gpt-oss-120b',
    completionModel: 'openai/gpt-oss-20b',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek models via the DeepSeek API.',
    defaultBaseURL: 'https://api.deepseek.com',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
    suggestedModels: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tags: ['flagship'] },
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', tags: ['fast', 'cheap'] },
    ],
    defaultModel: 'deepseek-v4-pro',
    completionModel: 'deepseek-flash',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'mistral',
    label: 'Mistral',
    description: 'Mistral models via La Plateforme.',
    defaultBaseURL: 'https://api.mistral.ai/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    suggestedModels: [
      { id: 'mistral-medium-latest', label: 'Mistral Medium (latest)', tags: ['balanced'] },
      { id: 'mistral-large-4', label: 'Mistral Large 4', tags: ['flagship'] },
      { id: 'mistral-small-latest', label: 'Mistral Small (latest)', tags: ['fast'] },
      { id: 'codestral-latest', label: 'Codestral (latest)', tags: ['coding'] },
    ],
    defaultModel: 'mistral-medium-latest',
    completionModel: 'mistral-small-latest',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
    browserNote: 'Mistral only allows a fixed set of request headers; do not add custom headers to this provider.',
  },
  {
    kind: 'xai',
    label: 'xAI',
    description: 'Grok models via the xAI API.',
    defaultBaseURL: 'https://api.x.ai/v1',
    needsBaseURL: false,
    needsApiKey: true,
    apiKeyUrl: 'https://console.x.ai/',
    docsUrl: 'https://docs.x.ai/docs/models',
    suggestedModels: [
      { id: 'grok-4.7', label: 'Grok 4.7', tags: ['flagship'] },
      { id: 'grok-build-0.1', label: 'Grok Build 0.1', tags: ['coding'] },
      { id: 'grok-4.6', label: 'Grok 4.6' },
    ],
    defaultModel: 'grok-4.7',
    supportsTools: true,
    supportsModelListing: true,
    browser: 'ok',
  },
  {
    kind: 'openai-compatible',
    label: 'OpenAI-compatible',
    description: 'Any endpoint implementing the OpenAI Chat Completions API (vLLM, llama.cpp server, LiteLLM, Together, Fireworks, …).',
    needsBaseURL: true,
    needsApiKey: 'optional',
    suggestedModels: [],
    supportsTools: true,
    supportsModelListing: true,
    browser: 'config',
    browserNote: 'The server must allow CORS from this origin (or use the desktop app). Tool calling depends on the model/server.',
  },
  {
    kind: 'ollama',
    label: 'Ollama',
    description: 'Local models served by Ollama.',
    defaultBaseURL: 'http://localhost:11434/v1',
    needsBaseURL: false,
    needsApiKey: false,
    docsUrl: 'https://ollama.com/library',
    suggestedModels: [
      { id: 'gpt-oss:20b', label: 'gpt-oss 20B', tags: ['local'] },
      { id: 'qwen3', label: 'Qwen 3', tags: ['local'] },
      { id: 'llama3.3', label: 'Llama 3.3', tags: ['local'] },
    ],
    supportsTools: true,
    supportsModelListing: true,
    browser: 'config',
    browserNote:
      'Ollama accepts localhost/127.0.0.1, app:// and file:// origins by default. For TexIt served from another origin, start Ollama with OLLAMA_ORIGINS set to that origin. Tool calling requires a tool-capable model.',
  },
  {
    kind: 'lmstudio',
    label: 'LM Studio',
    description: 'Local models served by LM Studio.',
    defaultBaseURL: 'http://localhost:1234/v1',
    needsBaseURL: false,
    needsApiKey: false,
    docsUrl: 'https://lmstudio.ai/docs/app/api',
    suggestedModels: [],
    supportsTools: true,
    supportsModelListing: true,
    browser: 'config',
    browserNote: 'Enable “Enable CORS” in LM Studio’s server settings (or run `lms server start --cors`).',
  },
  {
    kind: 'cli',
    label: 'CLI agent (subscription)',
    description: 'Use Codex CLI, Claude Code, Gemini CLI or opencode with your existing subscription. Desktop app only.',
    needsBaseURL: false,
    needsApiKey: false,
    suggestedModels: [],
    supportsTools: true,
    supportsModelListing: false,
    browser: 'desktop-only',
    browserNote: 'Runs the CLI locally through the desktop app; the project is mirrored to disk for the agent.',
    desktopOnly: true,
  },
];

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((p) => p.kind === kind);
  if (!preset) throw new Error(`Unknown provider kind: ${kind}`);
  return preset;
}

/** Create a new `ProviderConfig` pre-filled from the preset. */
export function createProviderConfig(kind: ProviderKind, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const preset = getProviderPreset(kind);
  return {
    id: overrides.id ?? `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: preset.label,
    enabled: true,
    baseURL: preset.defaultBaseURL,
    models: preset.suggestedModels.map((m) => m.id),
    defaultModel: preset.defaultModel,
    ...overrides,
  };
}

// ─────────────────────────── Model factory ───────────────────────────

export interface CreateModelOptions {
  /**
   * Custom fetch (e.g. a desktop main-process fetch that is not subject to CORS).
   * Defaults to `globalThis.fetch` with the `user-agent` header removed in browsers
   * (Firefox would otherwise add it to CORS preflights, which some providers reject).
   */
  fetch?: FetchFn;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isBrowserEnv(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/** fetch wrapper that drops `user-agent` (a forbidden/preflight-triggering header in browsers). */
export function createBrowserSafeFetch(base?: FetchFn): FetchFn {
  const f: FetchFn = (input, init) => {
    const impl = base ?? globalThis.fetch;
    if (init?.headers) {
      const headers = new Headers(init.headers);
      headers.delete('user-agent');
      return impl(input, { ...init, headers });
    }
    return impl(input, init);
  };
  return f;
}

function resolveFetch(opts?: CreateModelOptions): FetchFn | undefined {
  if (opts?.fetch) return opts.fetch;
  return isBrowserEnv() ? createBrowserSafeFetch() : undefined;
}

/** Effective base URL of a provider config (config value, else preset default). */
export function resolveBaseURL(config: ProviderConfig): string | undefined {
  const raw = config.baseURL?.trim() || getProviderPreset(config.kind).defaultBaseURL;
  return raw ? trimSlash(raw) : undefined;
}

function requireKey(config: ProviderConfig): string {
  const key = config.apiKey?.trim();
  if (!key) throw new Error(`${config.name || config.kind}: an API key is required.`);
  return key;
}

function openRouterHeaders(config: ProviderConfig): Record<string, string> {
  return { 'X-OpenRouter-Title': 'TexIt', ...(config.headers ?? {}) };
}

/**
 * Build an AI SDK language model for a configured provider.
 * Throws for `cli` providers (use `runCliAgent`) and for missing required settings.
 */
export function createLanguageModel(config: ProviderConfig, modelId?: string, opts?: CreateModelOptions): AiModel {
  const id = (modelId ?? config.defaultModel ?? config.models[0] ?? getProviderPreset(config.kind).defaultModel)?.trim();
  if (!id) throw new Error(`${config.name || config.kind}: no model selected.`);
  const fetch = resolveFetch(opts);
  const baseURL = resolveBaseURL(config);
  const apiKey = config.apiKey?.trim() || undefined;

  switch (config.kind) {
    case 'anthropic':
      return createAnthropic({
        baseURL,
        apiKey: requireKey(config),
        headers: { 'anthropic-dangerous-direct-browser-access': 'true', ...(config.headers ?? {}) },
        fetch,
      })(id);
    case 'openai':
      return createOpenAI({ baseURL, apiKey: requireKey(config), headers: config.headers, fetch })(id);
    case 'google':
      return createGoogle({ baseURL, apiKey: requireKey(config), headers: config.headers, fetch })(id);
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: baseURL!,
        apiKey: requireKey(config),
        headers: openRouterHeaders(config),
        includeUsage: true,
        fetch,
      }).chatModel(id);
    case 'groq':
    case 'deepseek':
    case 'mistral':
    case 'xai':
      return createOpenAICompatible({
        name: config.kind,
        baseURL: baseURL!,
        apiKey: requireKey(config),
        headers: config.headers,
        includeUsage: true,
        fetch,
      }).chatModel(id);
    case 'openai-compatible':
    case 'ollama':
    case 'lmstudio': {
      if (!baseURL) throw new Error(`${config.name || config.kind}: a base URL is required.`);
      return createOpenAICompatible({
        name: config.kind === 'openai-compatible' ? 'openai-compatible' : config.kind,
        baseURL,
        apiKey,
        headers: config.headers,
        includeUsage: true,
        fetch,
      }).chatModel(id);
    }
    case 'cli':
      throw new Error('CLI agents are not AI SDK models; run them with runCliAgent() (desktop only).');
    default: {
      const kind: never = config.kind;
      throw new Error(`Unsupported provider kind: ${String(kind)}`);
    }
  }
}

/** Resolve a `ModelRef` against settings into its provider config + model. */
export function resolveModelRef(
  settings: Pick<AISettings, 'providers'>,
  ref: ModelRef | undefined,
  opts?: CreateModelOptions,
): { config: ProviderConfig; modelId: string; model: AiModel | null } | null {
  if (!ref) return null;
  const config = settings.providers.find((p) => p.id === ref.providerId);
  if (!config || !config.enabled) return null;
  const model = config.kind === 'cli' ? null : createLanguageModel(config, ref.modelId, opts);
  return { config, modelId: ref.modelId, model };
}

// ─────────────────────────── Model listing ───────────────────────────

export interface ListModelsOptions {
  signal?: AbortSignal;
  fetch?: FetchFn;
}

/** Error with an HTTP status (if any) and a user-facing hint. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

function authHeaders(config: ProviderConfig): Record<string, string> {
  const key = config.apiKey?.trim();
  switch (config.kind) {
    case 'anthropic':
      return {
        ...(key ? { 'x-api-key': key } : {}),
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(config.headers ?? {}),
      };
    case 'google':
      return { ...(key ? { 'x-goog-api-key': key } : {}), ...(config.headers ?? {}) };
    case 'openrouter':
      return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...openRouterHeaders(config) };
    default:
      return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(config.headers ?? {}) };
  }
}

async function getJson(url: string, headers: Record<string, string>, opts?: ListModelsOptions): Promise<any> {
  const f = opts?.fetch ?? (isBrowserEnv() ? createBrowserSafeFetch() : globalThis.fetch);
  let res: Response;
  try {
    res = await f(url, { method: 'GET', headers, signal: opts?.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ProviderRequestError(
      `Could not reach ${new URL(url).origin}: ${(err as Error)?.message ?? String(err)}`,
      undefined,
      'Network error — the server may be down, or it does not allow requests from this origin (CORS).',
    );
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new ProviderRequestError(`HTTP ${res.status} from ${url}${body ? `: ${body}` : ''}`, res.status, httpHint(res.status));
  }
  return res.json();
}

function httpHint(status: number): string | undefined {
  if (status === 401 || status === 403) return 'The API key was rejected — check that it is correct and has access.';
  if (status === 404) return 'Endpoint not found — check the base URL.';
  if (status === 429) return 'Rate limited or out of credits.';
  if (status >= 500) return 'The provider reported a server error; try again later.';
  return undefined;
}

function sortModels(models: ListedModel[]): ListedModel[] {
  const seen = new Set<string>();
  return models
    .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Ollama's native API root (strip a trailing `/v1`). */
function ollamaRoot(baseURL: string): string {
  return baseURL.replace(/\/v1$/, '');
}

/**
 * Fetch the list of models available to this provider configuration.
 * OpenAI-compatible `/models`, Anthropic `/v1/models`, Gemini `models`, Ollama `/api/tags`.
 */
export async function listModels(config: ProviderConfig, opts?: ListModelsOptions): Promise<ListedModel[]> {
  const baseURL = resolveBaseURL(config);
  const headers = authHeaders(config);
  switch (config.kind) {
    case 'cli':
      return [];
    case 'anthropic': {
      const out: ListedModel[] = [];
      let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = `${baseURL}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
        const json = await getJson(url, headers, opts);
        for (const m of json.data ?? []) out.push({ id: m.id, label: m.display_name, contextWindow: m.max_input_tokens });
        if (!json.has_more || !json.last_id) break;
        after = json.last_id;
      }
      return out; // API order is newest first; keep it.
    }
    case 'google': {
      const out: ListedModel[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = `${baseURL}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const json = await getJson(url, headers, opts);
        for (const m of json.models ?? []) {
          const methods: string[] = m.supportedGenerationMethods ?? [];
          if (methods.length && !methods.includes('generateContent')) continue;
          out.push({ id: String(m.name).replace(/^models\//, ''), label: m.displayName, contextWindow: m.inputTokenLimit });
        }
        if (!json.nextPageToken) break;
        pageToken = json.nextPageToken;
      }
      return sortModels(out);
    }
    case 'ollama': {
      if (!baseURL) throw new ProviderRequestError('A base URL is required.');
      try {
        const json = await getJson(`${ollamaRoot(baseURL)}/api/tags`, headers, opts);
        return sortModels((json.models ?? []).map((m: any) => ({ id: m.model ?? m.name, label: m.name })));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        // Fall back to the OpenAI-compatible endpoint (e.g. behind a proxy that only exposes /v1).
        return listOpenAICompatible(baseURL, headers, opts);
      }
    }
    default: {
      if (!baseURL) throw new ProviderRequestError('A base URL is required.');
      const models = await listOpenAICompatible(baseURL, headers, opts);
      return FILTERED_KINDS.has(config.kind) ? models.filter((m) => isLikelyChatModel(m.id)) : models;
    }
  }
}

/** First-party APIs whose /models also lists embedding, speech, image… models. */
const FILTERED_KINDS = new Set<ProviderKind>(['openai', 'groq', 'mistral', 'xai', 'deepseek']);
const NON_CHAT = /(embed|tts|whisper|transcribe|dall-e|gpt-image|image|audio|realtime|moderation|davinci|babbage|guard|ocr|speech)/i;

/** Heuristic: drop ids that are clearly not chat/text-generation models. */
export function isLikelyChatModel(id: string): boolean {
  return !NON_CHAT.test(id);
}

async function listOpenAICompatible(baseURL: string, headers: Record<string, string>, opts?: ListModelsOptions): Promise<ListedModel[]> {
  const json = await getJson(`${baseURL}/models`, headers, opts);
  const data: any[] = Array.isArray(json) ? json : (json.data ?? json.models ?? []);
  return sortModels(
    data.map((m) => ({
      id: String(m.id ?? m.name ?? ''),
      label: m.name && m.name !== m.id ? String(m.name) : undefined,
      contextWindow: m.context_length ?? m.context_window ?? undefined,
      ownedBy: m.owned_by ?? undefined,
    })),
  );
}

// ─────────────────────────── Connection test ───────────────────────────

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  hint?: string;
  latencyMs: number;
  /** Populated when model listing succeeded. */
  models?: ListedModel[];
}

/**
 * Check that a provider is reachable and the key works. Tries model listing first and
 * falls back to a 1-token generation with the configured model.
 */
export async function testConnection(
  config: ProviderConfig,
  opts?: ListModelsOptions & { modelId?: string },
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  if (config.kind === 'cli') {
    return { ok: false, message: 'CLI agents are tested through the desktop app (host.agents.detect()).', latencyMs: 0 };
  }
  const preset = getProviderPreset(config.kind);
  if (preset.needsApiKey === true && !config.apiKey?.trim()) {
    return { ok: false, message: 'Missing API key.', hint: preset.apiKeyUrl ? `Create one at ${preset.apiKeyUrl}` : undefined, latencyMs: 0 };
  }
  let listError: unknown;
  try {
    const models = await listModels(config, opts);
    return { ok: true, message: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available.`, latencyMs: elapsed(), models };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    listError = err;
    // Auth failures are definitive; don't spend a generation on them.
    if (err instanceof ProviderRequestError && (err.status === 401 || err.status === 403)) {
      return { ok: false, message: err.message, hint: err.hint, latencyMs: elapsed() };
    }
  }
  const modelId = opts?.modelId ?? config.defaultModel ?? config.models[0];
  if (!modelId) {
    const e = listError as ProviderRequestError;
    return { ok: false, message: e?.message ?? String(listError), hint: e?.hint ?? browserHint(preset), latencyMs: elapsed() };
  }
  try {
    const model = createLanguageModel(config, modelId, { fetch: opts?.fetch });
    await generateText({ model, prompt: 'Reply with "ok".', maxOutputTokens: 16, maxRetries: 0, abortSignal: opts?.signal });
    return { ok: true, message: `Connected — ${modelId} responded (model listing unavailable).`, latencyMs: elapsed() };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    const described = describeError(err);
    return { ok: false, message: described.message, hint: described.hint ?? browserHint(preset), latencyMs: elapsed() };
  }
}

function browserHint(preset: ProviderPreset): string | undefined {
  return preset.browser === 'ok' ? undefined : preset.browserNote;
}

/** Turn any provider/SDK error into a short, user-facing message (+ optional hint). */
export function describeError(err: unknown): { message: string; hint?: string; status?: number } {
  if (err == null) return { message: 'Unknown error' };
  if (err instanceof ProviderRequestError) return { message: err.message, hint: err.hint, status: err.status };
  const e = err as any;
  const status: number | undefined = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : undefined;
  let message: string = typeof e.message === 'string' && e.message ? e.message : String(err);
  // Prefer the provider's error message from the response body when available.
  if (typeof e.responseBody === 'string' && e.responseBody) {
    try {
      const body = JSON.parse(e.responseBody);
      const inner = body?.error?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : undefined);
      if (inner) message = String(inner);
    } catch {
      /* not JSON */
    }
  }
  if (e.lastError && e.errors) {
    // RetryError: report the last underlying failure.
    return describeError(e.lastError);
  }
  let hint = status ? httpHint(status) : undefined;
  if (!status && /failed to fetch|fetch failed|networkerror|load failed|cors/i.test(message)) {
    hint = 'Network error — the server may be unreachable, or it does not allow requests from this origin (CORS).';
  }
  return { message, hint, status };
}
