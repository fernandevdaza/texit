import { useMemo, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Eye, EyeOff, Info, RefreshCw, Search, Trash2, X, Zap } from 'lucide-react';
import { getProviderPreset, testConnection, listModels, type ListedModel, type ProviderPreset } from '@texit/ai';
import { cn } from '@/lib/cn';
import { host } from '@/lib/platform';
import { Badge, Button, confirmDialog, IconButton, Input, Select, Switch, toast } from '@/ui';
import { DEV, hasKey, needsKey, providerReady, toProviderConfig } from '../runtime';
import { secretKeys, setSecret, useSecrets } from '../secrets';
import { DEV_MOCK_KIND, useAiSettings, type ProviderEntry } from '../store';
import { ProviderLogo } from '../components/ProviderLogo';

export function presetFor(p: ProviderEntry): ProviderPreset | null {
  if (p.kind === DEV_MOCK_KIND) return null;
  try {
    return getProviderPreset(p.kind);
  } catch {
    return null;
  }
}

function openLink(url: string) {
  if (host) void host.shell.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' | 'error' | 'busy' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        tone === 'ok' && 'bg-success shadow-[0_0_0_3px_var(--tx-success-soft)]',
        tone === 'warn' && 'bg-warning shadow-[0_0_0_3px_var(--tx-warning-soft)]',
        tone === 'error' && 'bg-danger shadow-[0_0_0_3px_var(--tx-danger-soft)]',
        tone === 'busy' && 'animate-pulse bg-accent',
        tone === 'off' && 'bg-border-strong',
      )}
    />
  );
}

function ApiKeyField({ p }: { p: ProviderEntry }) {
  const stored = useSecrets((s) => s.values[secretKeys.apiKey(p.id)] ?? '');
  const webPersist = useSecrets((s) => s.webPersist);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const preset = presetFor(p);
  const save = async () => {
    const v = value.trim();
    if (!v) return;
    await setSecret(secretKeys.apiKey(p.id), v);
    setValue('');
    if (!host && !webPersist) toast.info('Key saved for this session only', { description: 'Enable “Remember API keys in this browser” above to keep it after reloading.' });
    else toast.success('API key saved');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium">API key</label>
        {preset?.apiKeyUrl && (
          <button onClick={() => openLink(preset.apiKeyUrl!)} className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline">
            Get a key <ExternalLink className="size-3" />
          </button>
        )}
      </div>
      {stored ? (
        <div className="flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 font-mono text-[12px] text-fg-muted">
            <Check className="size-3.5 text-success" />
            {show ? stored : `${stored.slice(0, 5)}${'•'.repeat(12)}${stored.slice(-4)}`}
          </div>
          <IconButton label={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}>
            {show ? <EyeOff /> : <Eye />}
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => void setSecret(secretKeys.apiKey(p.id), null)}>
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input type="password" autoComplete="off" placeholder={p.kind === 'anthropic' ? 'sk-ant-…' : 'Paste your API key'} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            Save
          </Button>
        </form>
      )}
      <p className="text-[11px] text-fg-subtle">
        {host ? 'Stored in your OS keychain.' : webPersist ? 'Stored only in this browser (localStorage).' : 'Kept in memory for this session only.'} Never synced to collaborators.
      </p>
    </div>
  );
}

function ModelManager({ p }: { p: ProviderEntry }) {
  const update = useAiSettings((s) => s.updateProvider);
  const [listed, setListed] = useState<ListedModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [custom, setCustom] = useState('');
  const preset = presetFor(p);
  const canList = p.kind !== DEV_MOCK_KIND && p.kind !== 'cli' && preset?.supportsModelListing !== false;

  const fetchModels = async () => {
    setLoading(true);
    try {
      const models = await listModels(toProviderConfig(p));
      setListed(models);
      if (!models.length) toast.info('The provider returned no models.');
    } catch (e) {
      const err = e as { message?: string; hint?: string };
      toast.error('Could not list models', { description: [err.message, err.hint].filter(Boolean).join(' — ') });
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    const has = p.models.includes(id);
    const models = has ? p.models.filter((m) => m !== id) : [...p.models, id];
    update(p.id, { models, defaultModel: p.defaultModel && models.includes(p.defaultModel) ? p.defaultModel : models[0] });
  };

  const shown = useMemo(() => (listed ?? []).filter((m) => m.id.toLowerCase().includes(filter.toLowerCase())).slice(0, 200), [listed, filter]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium">Models</label>
        {canList && (
          <Button size="xs" variant="ghost" icon={<RefreshCw className={cn(loading && 'animate-spin')} />} onClick={() => void fetchModels()} disabled={loading}>
            Fetch available models
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {p.models.map((m) => (
          <span key={m} className={cn('inline-flex h-6 items-center gap-1 rounded-md border pl-2 pr-0.5 font-mono text-[11px]', m === p.defaultModel ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-surface-2 text-fg-muted')}>
            <button onClick={() => update(p.id, { defaultModel: m })} title="Make default">
              {m}
            </button>
            <button onClick={() => toggle(m)} className="flex size-4 items-center justify-center rounded hover:bg-hover" aria-label={`Remove ${m}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <form
          className="inline-flex"
          onSubmit={(e) => {
            e.preventDefault();
            const v = custom.trim();
            if (v && !p.models.includes(v)) toggle(v);
            setCustom('');
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="+ add model id"
            className="h-6 w-32 rounded-md border border-dashed border-border-strong bg-transparent px-2 font-mono text-[11px] outline-none placeholder:text-fg-subtle focus:border-accent"
          />
        </form>
      </div>
      {listed && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border p-1.5">
            <Input inputSize="sm" icon={<Search />} placeholder={`Filter ${listed.length} models`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {shown.map((m) => (
              <label key={m.id} className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[12px] hover:bg-hover">
                <input type="checkbox" checked={p.models.includes(m.id)} onChange={() => toggle(m.id)} className="accent-[var(--tx-accent)]" />
                <span className="truncate font-mono text-[11.5px]">{m.id}</span>
                {m.label && m.label !== m.id && <span className="truncate text-[11px] text-fg-subtle">{m.label}</span>}
                {m.contextWindow && <span className="ml-auto shrink-0 text-[10.5px] text-fg-subtle">{Math.round(m.contextWindow / 1000)}k ctx</span>}
              </label>
            ))}
            {!shown.length && <div className="px-2 py-3 text-center text-[11.5px] text-fg-subtle">No matching models</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderCard({ p, defaultOpen }: { p: ProviderEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [testing, setTesting] = useState(false);
  const update = useAiSettings((s) => s.updateProvider);
  const remove = useAiSettings((s) => s.removeProvider);
  useSecrets((s) => s.values);
  const preset = presetFor(p);
  const ready = providerReady(p);
  const tone = !p.enabled ? 'off' : p.lastTest && !p.lastTest.ok ? 'error' : ready ? 'ok' : 'warn';
  const statusText = !p.enabled
    ? 'Disabled'
    : needsKey(p) && !hasKey(p)
      ? 'API key required'
      : p.lastTest
        ? p.lastTest.ok
          ? `Connected · ${p.lastTest.latencyMs} ms`
          : 'Connection failed'
        : p.kind === DEV_MOCK_KIND
          ? 'Scripted responses, no network'
          : 'Ready';

  const runTest = async () => {
    setTesting(true);
    try {
      let res: { ok: boolean; message: string; hint?: string; latencyMs: number };
      if (p.kind === DEV_MOCK_KIND) res = { ok: DEV, message: DEV ? 'Mock provider ready.' : 'Unavailable in production builds.', latencyMs: 0 };
      else if (p.kind === 'cli') {
        const t0 = Date.now();
        const agents = host ? await host.agents.detect() : [];
        const a = agents.find((x) => x.id === p.cliAgent);
        res = { ok: !!a?.installed, message: a?.installed ? `${a.name} ${a.version ?? ''} found` : (a?.hint ?? 'Not installed'), latencyMs: Date.now() - t0 };
      } else res = await testConnection(toProviderConfig(p), { modelId: p.defaultModel });
      update(p.id, { lastTest: { ok: res.ok, message: res.message, latencyMs: res.latencyMs, at: Date.now() } });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message, { description: res.hint });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-surface transition-shadow', open ? 'border-border-strong shadow-card' : 'border-border')}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ProviderLogo kind={p.kind} cliAgent={p.cliAgent} size={30} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <span className="truncate">{p.name}</span>
              {(p.kind === 'ollama' || p.kind === 'lmstudio') && <Badge tone="neutral">local</Badge>}
              {p.kind === DEV_MOCK_KIND && <Badge tone="accent">dev</Badge>}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
              <StatusDot tone={tone} />
              <span className="truncate">{statusText}</span>
              {p.defaultModel && <span className="truncate font-mono text-[10.5px]">· {p.defaultModel}</span>}
            </div>
          </div>
        </button>
        <Switch size="sm" checked={p.enabled} onCheckedChange={(v) => update(p.id, { enabled: v })} />
        <IconButton label={open ? 'Collapse' : 'Configure'} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
        </IconButton>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border bg-surface-2/40 px-4 py-3.5">
          {preset?.browserNote && (
            <div className="flex gap-2 rounded-lg bg-info-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-fg-muted">
              <Info className="mt-px size-3.5 shrink-0 text-info" />
              {preset.browserNote}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium">Display name</label>
              <Input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
            </div>
            {p.kind !== 'cli' && p.kind !== DEV_MOCK_KIND && (
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium">Base URL</label>
                <Input
                  value={p.baseURL ?? ''}
                  placeholder={preset?.defaultBaseURL ?? 'https://…/v1'}
                  onChange={(e) => update(p.id, { baseURL: e.target.value || undefined })}
                />
              </div>
            )}
          </div>
          {needsKey(p) && <ApiKeyField p={p} />}
          {(p.kind === 'openai-compatible' || p.kind === 'ollama' || p.kind === 'lmstudio') && !needsKey(p) && (
            <details className="text-[12px]">
              <summary className="cursor-default text-fg-muted">Optional API key</summary>
              <div className="mt-2">
                <ApiKeyField p={p} />
              </div>
            </details>
          )}
          <ModelManager p={p} />
          {p.models.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="shrink-0 text-[12px] font-medium">Default model</label>
              <Select size="sm" className="max-w-xs" value={p.defaultModel} onValueChange={(v) => update(p.id, { defaultModel: v })} options={p.models.map((m) => ({ value: m, label: m }))} />
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Button size="sm" icon={<Zap />} loading={testing} onClick={() => void runTest()}>
              Test connection
            </Button>
            {p.lastTest && (
              <span className={cn('min-w-0 truncate text-[11.5px]', p.lastTest.ok ? 'text-success' : 'text-danger')} title={p.lastTest.message}>
                {p.lastTest.message}
              </span>
            )}
            <span className="flex-1" />
            {preset?.docsUrl && (
              <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => openLink(preset.docsUrl!)}>
                Docs
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (await confirmDialog({ title: `Remove ${p.name}?`, message: 'Its API key is deleted too.', confirmLabel: 'Remove', danger: true })) {
                  await setSecret(secretKeys.apiKey(p.id), null);
                  remove(p.id);
                }
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
