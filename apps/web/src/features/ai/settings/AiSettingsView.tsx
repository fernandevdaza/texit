import { useMemo } from 'react';
import { ChevronDown, FlaskConical, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { PROVIDER_PRESETS, getProviderPreset, type ProviderKind } from '@texit/ai';
import { host } from '@/lib/platform';
import { t as tr, useLocale, useT } from '@/lib/i18n';
import { Button, confirmDialog, DropdownMenu, Select, Switch, Textarea, type MenuEntry, type SelectOption } from '@/ui';
import { Card, Row, ToggleRow } from '@/features/settings/parts';
import { DEV, providerReady } from '../runtime';
import { setWebPersist, useSecrets } from '../secrets';
import { DEV_MOCK_KIND, newId, useAiSettings, type ProviderEntry } from '../store';
import { ProviderLogo } from '../components/ProviderLogo';
import { ProviderCard } from './ProviderCard';
import { CliSection, ExposeSection, McpSection } from './Sections';

const QUICK: { kind: ProviderKind; label: string }[] = [
  { kind: 'openai', label: 'OpenAI' },
  { kind: 'anthropic', label: 'Anthropic' },
  { kind: 'google', label: 'Gemini' },
  { kind: 'openrouter', label: 'OpenRouter' },
  { kind: 'ollama', label: 'Ollama (local)' },
  { kind: 'lmstudio', label: 'LM Studio (local)' },
];

function addPreset(kind: ProviderKind | typeof DEV_MOCK_KIND) {
  const s = useAiSettings.getState();
  if (kind === DEV_MOCK_KIND) {
    const entry: ProviderEntry = { id: newId('mock'), kind, name: 'Dev mock', enabled: true, models: ['mock-agent'], defaultModel: 'mock-agent' };
    s.addProvider(entry);
    if (!s.completionModel) s.set({ completionModel: { providerId: entry.id, modelId: 'mock-agent' } });
    return entry.id;
  }
  const preset = getProviderPreset(kind);
  const entry: ProviderEntry = {
    id: newId(kind),
    kind,
    name: preset.label,
    enabled: true,
    baseURL: preset.defaultBaseURL,
    models: preset.suggestedModels.map((m) => m.id),
    defaultModel: preset.defaultModel ?? preset.suggestedModels[0]?.id,
  };
  s.addProvider(entry);
  if (!s.completionModel && preset.completionModel) s.set({ completionModel: { providerId: entry.id, modelId: preset.completionModel } });
  return entry.id;
}

function addMenu(): MenuEntry[] {
  const items: MenuEntry[] = [{ type: 'label', label: tr('ai.settings.apiProviders') }];
  for (const p of PROVIDER_PRESETS) {
    if (p.kind === 'cli') continue;
    if (p.kind === 'ollama') items.push({ type: 'separator' }, { type: 'label', label: tr('ai.settings.localCustom') });
    items.push({ label: p.label, icon: <ProviderLogo kind={p.kind} size={16} />, hint: p.kind === 'ollama' || p.kind === 'lmstudio' ? tr('ai.settings.local') : undefined, onSelect: () => addPreset(p.kind) });
  }
  if (DEV) items.push({ type: 'separator' }, { label: tr('ai.settings.devMock'), icon: <FlaskConical />, onSelect: () => addPreset(DEV_MOCK_KIND) });
  return items;
}

function modelOptions(providers: ProviderEntry[], allowCli: boolean): SelectOption[] {
  const out: SelectOption[] = [];
  for (const p of providers) {
    if (!p.enabled || (!allowCli && p.kind === 'cli')) continue;
    for (const m of new Set([...(p.defaultModel ? [p.defaultModel] : []), ...p.models])) {
      out.push({
        value: `${p.id}::${m}`,
        label: m,
        description: `${p.name}${providerReady(p) ? '' : ` · ${tr('ai.needsSetup')}`}`,
        icon: <ProviderLogo kind={p.kind} cliAgent={p.cliAgent} size={14} />,
      });
    }
  }
  return out;
}

const encode = (r?: { providerId: string; modelId: string }) => (r ? `${r.providerId}::${r.modelId}` : undefined);
const decode = (v: string) => {
  const i = v.indexOf('::');
  return { providerId: v.slice(0, i), modelId: v.slice(i + 2) };
};

function KeyStorageCard() {
  const t = useT();
  const persist = useSecrets((s) => s.webPersist);
  if (host) {
    return (
      <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-border bg-success-soft/50 px-3.5 py-2.5 text-[12px] text-fg-muted">
        <ShieldCheck className="size-4 shrink-0 text-success" />
        {t('ai.settings.keychainNote')}
      </div>
    );
  }
  return (
    <Card title={t('ai.settings.apiKeys')} description={t('ai.settings.apiKeysDesc')}>
      <Row
        title={
          <span className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-fg-subtle" /> {t('ai.settings.rememberKeys')}
          </span>
        }
        description={persist ? t('ai.settings.rememberOn') : t('ai.settings.rememberOff')}
      >
        <Switch
          checked={persist}
          onCheckedChange={async (v) => {
            if (v) {
              const ok = await confirmDialog({
                title: t('ai.settings.rememberConfirmTitle'),
                message: t('ai.settings.rememberConfirmMessage'),
                confirmLabel: t('ai.settings.rememberConfirmLabel'),
              });
              if (!ok) return;
            }
            setWebPersist(v);
          }}
        />
      </Row>
    </Card>
  );
}

export default function AiSettingsView() {
  const t = useT();
  const locale = useLocale();
  const s = useAiSettings();
  useSecrets((x) => x.values);
  const chatOptions = useMemo(() => modelOptions(s.providers, true), [s.providers, locale]);
  const fastOptions = useMemo(() => modelOptions(s.providers, false), [s.providers, locale]);
  const providers = s.providers.filter((p) => p.kind !== DEV_MOCK_KIND || DEV);

  return (
    <div className="pb-4">
      <KeyStorageCard />

      <Card
        title={t('ai.settings.providers')}
        action={
          providers.length > 0 && (
            <DropdownMenu
              align="end"
              items={addMenu()}
              trigger={
                <Button size="xs" variant="ghost" iconRight={<ChevronDown />}>
                  {t('ai.settings.addProvider')}
                </Button>
              }
            />
          )
        }
      >
        {providers.length === 0 ? (
          <div className="px-5 py-7 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--tx-accent),#b06cff)] text-white shadow-md shadow-accent/25">
              <Sparkles className="size-5" />
            </div>
            <div className="text-[13.5px] font-semibold">{t('ai.settings.firstProvider')}</div>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-fg-subtle">
              {t(host ? 'ai.settings.firstProviderDesktop' : 'ai.settings.firstProviderWeb')}
            </p>
            <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-2">
              {QUICK.map((q) => (
                <button
                  key={q.kind}
                  onClick={() => addPreset(q.kind)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-[11.5px] font-medium text-fg-muted shadow-xs transition-[border,color,transform] hover:-translate-y-px hover:border-accent/40 hover:text-fg"
                >
                  <ProviderLogo kind={q.kind} size={26} />
                  {q.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-center gap-2">
              <DropdownMenu
                items={addMenu()}
                trigger={
                  <Button size="sm" variant="ghost" iconRight={<ChevronDown />}>
                    {t('ai.settings.moreProviders')}
                  </Button>
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2 bg-surface-2/30 p-2">
            {providers.map((p) => (
              <ProviderCard key={p.id} p={p} defaultOpen={providers.length === 1 && !providerReady(p)} />
            ))}
          </div>
        )}
      </Card>

      <Card title={t('ai.settings.models')}>
        <Row title={t('ai.settings.chatModel')} description={t('ai.settings.chatModelDesc')}>
          <Select
            className="w-60"
            size="sm"
            align="end"
            placeholder={t('ai.settings.chooseModel')}
            value={encode(s.chatModel)}
            onValueChange={(v) => s.set({ chatModel: decode(v) })}
            options={chatOptions}
          />
        </Row>
        <Row title={t('ai.settings.fastModel')} description={t('ai.settings.fastModelDesc')}>
          <Select
            className="w-60"
            size="sm"
            align="end"
            placeholder={t('ai.settings.sameAsChat')}
            value={encode(s.completionModel)}
            onValueChange={(v) => s.set({ completionModel: decode(v) })}
            options={fastOptions}
          />
        </Row>
        <ToggleRow
          title={t('ai.settings.inlineCompletions')}
          description={t('ai.settings.inlineCompletionsDesc')}
          checked={s.inlineCompletions}
          onChange={(v) => s.set({ inlineCompletions: v })}
        />
        <ToggleRow
          title={t('ai.settings.autoApply')}
          description={t('ai.settings.autoApplyDesc')}
          checked={s.autoApplyEdits}
          onChange={(v) => s.set({ autoApplyEdits: v })}
        />
        <Row title={t('ai.settings.customInstructions')} description={t('ai.settings.customInstructionsDesc')} stack>
          <Textarea
            value={s.customInstructions}
            onChange={(e) => s.set({ customInstructions: e.target.value })}
            placeholder={t('ai.settings.customInstructionsPlaceholder')}
            className="min-h-20 text-[12.5px]"
          />
        </Row>
      </Card>

      <CliSection />
      <McpSection />
      <ExposeSection />
    </div>
  );
}
