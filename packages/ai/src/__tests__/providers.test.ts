import { describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import {
  PROVIDER_PRESETS,
  createBrowserSafeFetch,
  createLanguageModel,
  createProviderConfig,
  describeError,
  listModels,
  resolveModelRef,
  testConnection,
} from '../providers';
import type { ProviderConfig, ProviderKind } from '../types';

function capturingFetch() {
  const calls: { url: string; headers: Headers; body?: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body as string | undefined });
    throw new Error('stop-here');
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function jsonFetch(routes: Record<string, unknown | ((url: string) => Response)>) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response('not found', { status: 404 });
    const r = routes[key];
    return typeof r === 'function' ? (r as (u: string) => Response)(url) : new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const cfg = (kind: ProviderKind, extra: Partial<ProviderConfig> = {}) => createProviderConfig(kind, { apiKey: 'sk-test', ...extra });

async function firstRequest(config: ProviderConfig, modelId: string) {
  const { fetch, calls } = capturingFetch();
  const model = createLanguageModel(config, modelId, { fetch });
  await generateText({ model, prompt: 'hi', maxRetries: 0 }).catch(() => {});
  return { model, call: calls[0] };
}

describe('provider catalog', () => {
  it('has a preset for every provider kind', () => {
    const kinds: ProviderKind[] = ['openai', 'anthropic', 'google', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai', 'openai-compatible', 'ollama', 'lmstudio', 'cli'];
    expect(PROVIDER_PRESETS.map((p) => p.kind).sort()).toEqual([...kinds].sort());
    for (const p of PROVIDER_PRESETS) {
      expect(p.label).toBeTruthy();
      if (p.defaultModel) expect(p.suggestedModels.map((m) => m.id)).toContain(p.defaultModel);
    }
    expect(createProviderConfig('ollama')).toMatchObject({ kind: 'ollama', baseURL: 'http://localhost:11434/v1', enabled: true });
  });
});

describe('createLanguageModel', () => {
  it('Anthropic: direct browser access header, x-api-key, messages endpoint', async () => {
    const { model, call } = await firstRequest(cfg('anthropic'), 'claude-opus-5-5');
    expect(model.provider).toMatch(/^anthropic/);
    expect(model.modelId).toBe('claude-opus-5-5');
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(call.headers.get('x-api-key')).toBe('sk-test');
  });

  it('OpenAI uses the Responses API', async () => {
    const { model, call } = await firstRequest(cfg('openai'), 'gpt-6.1-sol');
    expect(model.provider).toMatch(/^openai\.responses/);
    expect(call.url).toBe('https://api.openai.com/v1/responses');
    expect(call.headers.get('authorization')).toBe('Bearer sk-test');
  });

  it('Google uses the Gemini API key header', async () => {
    const { model, call } = await firstRequest(cfg('google'), 'gemini-3.8-flash');
    expect(model.provider).toMatch(/^google/);
    expect(call.url).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash');
    expect(call.headers.get('x-goog-api-key')).toBe('sk-test');
  });

  it.each([
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['mistral', 'https://api.mistral.ai/v1/chat/completions'],
    ['xai', 'https://api.x.ai/v1/chat/completions'],
  ] as const)('%s goes through the OpenAI-compatible chat endpoint', async (kind, url) => {
    const { model, call } = await firstRequest(cfg(kind), 'some-model');
    expect(model.provider).toBe(`${kind}.chat`);
    expect(call.url).toBe(url);
    expect(call.headers.get('authorization')).toBe('Bearer sk-test');
    if (kind === 'openrouter') expect(call.headers.get('x-openrouter-title')).toBe('TexIt');
  });

  it('local servers need no key', async () => {
    const { model, call } = await firstRequest(createProviderConfig('ollama'), 'qwen3');
    expect(model.provider).toBe('ollama.chat');
    expect(call.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(call.headers.get('authorization')).toBeNull();
    const lm = await firstRequest(createProviderConfig('lmstudio', { baseURL: 'http://127.0.0.1:1234/v1/' }), 'local-model');
    expect(lm.call.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
  });

  it('validates configuration', () => {
    expect(() => createLanguageModel(createProviderConfig('anthropic'), 'claude-opus-5-5')).toThrow(/API key is required/);
    expect(() => createLanguageModel(createProviderConfig('openai-compatible'), 'm')).toThrow(/base URL is required/);
    expect(() => createLanguageModel(createProviderConfig('cli'), 'x')).toThrow(/runCliAgent/);
    expect(createLanguageModel(cfg('anthropic')).modelId).toBe('claude-opus-5-5'); // falls back to defaultModel
  });

  it('resolveModelRef finds the provider', () => {
    const anthropic = cfg('anthropic', { id: 'a' });
    const cli = createProviderConfig('cli', { id: 'c', cliAgent: 'claude' });
    const r = resolveModelRef({ providers: [anthropic, cli] }, { providerId: 'a', modelId: 'claude-sonnet-5-5' });
    expect(r?.model?.modelId).toBe('claude-sonnet-5-5');
    expect(resolveModelRef({ providers: [anthropic, cli] }, { providerId: 'c', modelId: 'sonnet' })?.model).toBeNull();
    expect(resolveModelRef({ providers: [] }, { providerId: 'zz', modelId: 'x' })).toBeNull();
  });
});

describe('listModels / testConnection', () => {
  it('Anthropic /v1/models with pagination', async () => {
    const { fetch, calls } = jsonFetch({
      'https://api.anthropic.com/v1/models?limit=1000&after_id=m2': { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }], has_more: false },
      'https://api.anthropic.com/v1/models?limit=1000': { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1000000 }, { id: 'm2' }], has_more: true, last_id: 'm2' },
    });
    const models = await listModels(cfg('anthropic'), { fetch });
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'm2', 'claude-haiku-4-5']);
    expect(models[0]).toMatchObject({ label: 'Claude Opus 5.5', contextWindow: 1000000 });
    expect(calls[0].headers.get('anthropic-version')).toBe('2023-06-01');
    expect(calls[0].headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
  });

  it('Gemini filters to generateContent models', async () => {
    const { fetch } = jsonFetch({
      'https://generativelanguage.googleapis.com/v1beta/models': {
        models: [
          { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      },
    });
    expect((await listModels(cfg('google'), { fetch })).map((m) => m.id)).toEqual(['gemini-3.8-flash']);
  });

  it('Ollama uses /api/tags and falls back to /v1/models', async () => {
    const a = jsonFetch({ 'http://localhost:11434/api/tags': { models: [{ name: 'qwen3:latest', model: 'qwen3:latest' }] } });
    expect((await listModels(createProviderConfig('ollama'), { fetch: a.fetch })).map((m) => m.id)).toEqual(['qwen3:latest']);
    const b = jsonFetch({ 'http://localhost:11434/v1/models': { data: [{ id: 'llama3.3' }] } });
    expect((await listModels(createProviderConfig('ollama'), { fetch: b.fetch })).map((m) => m.id)).toEqual(['llama3.3']);
  });

  it('OpenAI-compatible /models (sorted, deduplicated)', async () => {
    const { fetch, calls } = jsonFetch({ 'https://openrouter.ai/api/v1/models': { data: [{ id: 'z/model', context_length: 1000 }, { id: 'a/model' }, { id: 'a/model' }] } });
    const models = await listModels(cfg('openrouter'), { fetch });
    expect(models.map((m) => m.id)).toEqual(['a/model', 'z/model']);
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-test');
  });

  it('filters non-chat models for first-party OpenAI-style APIs', async () => {
    const { fetch } = jsonFetch({ 'https://api.openai.com/v1/models': { data: [{ id: 'gpt-6.1-sol' }, { id: 'text-embedding-3-large' }, { id: 'whisper-1' }, { id: 'gpt-image-1' }, { id: 'gpt-6-luna' }] } });
    expect((await listModels(cfg('openai'), { fetch })).map((m) => m.id)).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
  });

  it('testConnection reports success, missing keys and auth failures', async () => {
    const ok = await testConnection(cfg('groq'), { fetch: jsonFetch({ 'https://api.groq.com/openai/v1/models': { data: [{ id: 'openai/gpt-oss-120b' }] } }).fetch });
    expect(ok).toMatchObject({ ok: true, message: expect.stringContaining('1 model') });
    expect(await testConnection(createProviderConfig('openai'))).toMatchObject({ ok: false, message: 'Missing API key.' });
    const unauthorized = jsonFetch({ 'https://api.openai.com/v1/models': () => new Response('{"error":{"message":"bad key"}}', { status: 401 }) });
    const bad = await testConnection(cfg('openai'), { fetch: unauthorized.fetch });
    expect(bad.ok).toBe(false);
    expect(bad.hint).toMatch(/API key was rejected/);
    expect(unauthorized.calls).toHaveLength(1); // no generation attempted after a 401
  });
});

describe('helpers', () => {
  it('createBrowserSafeFetch strips user-agent', async () => {
    const base = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response('ok')) as unknown as typeof fetch;
    await createBrowserSafeFetch(base)('https://x', { headers: { 'user-agent': 'ai-sdk', 'x-api-key': 'k' } });
    const headers = new Headers((base as any).mock.calls[0][1].headers);
    expect(headers.get('user-agent')).toBeNull();
    expect(headers.get('x-api-key')).toBe('k');
  });

  it('describeError extracts provider messages and hints', () => {
    expect(describeError({ message: 'Bad', statusCode: 429, responseBody: '{"error":{"message":"Rate limit reached"}}' })).toMatchObject({
      message: 'Rate limit reached',
      status: 429,
      hint: expect.stringMatching(/Rate limited/),
    });
    expect(describeError(new TypeError('Failed to fetch')).hint).toMatch(/CORS/);
  });
});
