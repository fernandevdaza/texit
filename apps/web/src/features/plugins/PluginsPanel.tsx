import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileUp, Link2, Plus, Puzzle, RefreshCw, RotateCw, Search, Wrench } from 'lucide-react';
import { DropdownMenu, EmptyState, IconButton, Input, PanelHeader, Segmented, Spinner } from '@/ui';
import { usePlugins, type PluginEntry } from './manager';
import { usePluginPrefs, useRegistry, type RegistryEntry } from './registry';
import { pickAndReload, pickPluginFile, promptInstallFromUrl } from './actions';
import { PluginCard, RegistryCard } from './PluginCard';
import { localizeManifest } from './localize';
import { useLocale, useT } from '@/lib/i18n';
import './i18n';

/** Replace `{name}` placeholders of a translated string with React nodes. */
export function richText(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return <Fragment key={i}>{m && m[1] in nodes ? nodes[m[1]] : part}</Fragment>;
  });
}

export function matchesQuery(q: string, ...fields: (string | string[] | undefined)[]) {
  if (!q) return true;
  const hay = fields.flat().filter(Boolean).join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function useFilteredPlugins(query: string) {
  const { entries, order } = usePlugins();
  const locale = useLocale();
  return useMemo(
    () =>
      order
        .map((id) => entries[id])
        .filter((e): e is PluginEntry => !!e)
        .filter((e) => {
          const l = localizeManifest(e.manifest, locale);
          return matchesQuery(query.trim(), e.manifest.name, e.manifest.description, l.name, l.description, e.manifest.author, e.id, e.manifest.tags);
        }),
    [entries, order, query, locale],
  );
}

export function useRegistryEntries(query: string): { items: RegistryEntry[]; loading: boolean; error: string | null; reload(): void } {
  const { entries, loading, error, load } = useRegistry();
  useEffect(() => {
    void load();
  }, [load]);
  const items = useMemo(
    () => entries.filter((e) => matchesQuery(query.trim(), e.name, e.description, e.author, e.id, e.tags)),
    [entries, query],
  );
  return { items, loading, error, reload: () => void load(true) };
}

/** Plugins sidebar: Installed / Browse tabs, search, install actions. */
export function PluginsPanel() {
  const t = useT();
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [query, setQuery] = useState('');
  const ready = usePlugins((s) => s.ready);
  const installed = useFilteredPlugins(query);
  const registry = useRegistryEntries(tab === 'browse' ? query : '');
  const devMode = usePluginPrefs((s) => s.devMode);
  const total = usePlugins((s) => s.order.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('plugins.title')}
        actions={
          <>
            {tab === 'browse' && (
              <IconButton label={t('plugins.refreshRegistry')} size="xs" onClick={registry.reload}>
                <RefreshCw />
              </IconButton>
            )}
            <DropdownMenu
              align="end"
              items={[
                { label: t('plugins.installFromUrlMenu'), icon: <Link2 />, onSelect: () => void promptInstallFromUrl() },
                { label: t('plugins.installFromFileMenu'), icon: <FileUp />, onSelect: () => void pickPluginFile() },
                { type: 'separator' },
                { label: t('plugins.reloadAPlugin'), icon: <RotateCw />, onSelect: () => void pickAndReload() },
                {
                  label: t('plugins.devMode'),
                  icon: <Wrench />,
                  checked: devMode,
                  hint: devMode ? t('plugins.devModeOn') : undefined,
                  onSelect: () => usePluginPrefs.getState().set({ devMode: !devMode }),
                },
              ]}
              trigger={
                <button aria-label={t('plugins.installPlugin')} className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg [&_svg]:size-3.5">
                  <Plus />
                </button>
              }
            />
          </>
        }
      />
      <div className="space-y-2 px-3 pb-2">
        <Segmented
          size="sm"
          className="[&>div]:flex [&>div]:w-full [&_button]:flex-1 [&_button]:justify-center"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'installed', label: <span className="whitespace-nowrap">{t('plugins.tabInstalled')}{total ? <span className="ml-1 text-fg-subtle">{total}</span> : null}</span> },
            { value: 'browse', label: t('plugins.tabBrowse') },
          ]}
        />
        <Input inputSize="sm" icon={<Search />} placeholder={tab === 'installed' ? t('plugins.searchInstalled') : t('plugins.searchRegistry')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {devMode && (
          <div className="flex items-center gap-1.5 rounded-md bg-info-soft px-2 py-1 text-[11px] text-info">
            <Wrench className="size-3" /> {t('plugins.devModeNote')}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {tab === 'installed' ? (
          !ready ? (
            <div className="flex justify-center py-10 text-fg-subtle">
              <Spinner />
            </div>
          ) : installed.length ? (
            installed.map((e) => <PluginCard key={e.id} entry={e} />)
          ) : (
            <EmptyState icon={<Puzzle />} title={t('plugins.noneFound')} description={query ? t('plugins.nothingMatches', { query }) : undefined} />
          )
        ) : registry.loading && !registry.items.length ? (
          <div className="flex justify-center py-10 text-fg-subtle">
            <Spinner />
          </div>
        ) : registry.error ? (
          <EmptyState icon={<Puzzle />} title={t('plugins.registryUnavailable')} description={registry.error} />
        ) : registry.items.length ? (
          registry.items.map((e) => <RegistryCard key={e.id} item={e} />)
        ) : (
          <EmptyState icon={<Puzzle />} title={t('plugins.noneFound')} description={query ? t('plugins.nothingMatches', { query }) : t('plugins.registryEmpty')} />
        )}
        {tab === 'browse' && (
          <p className="px-1 pt-2 text-center text-[11px] leading-relaxed text-fg-subtle">
            {richText(t('plugins.haveUrl'), {
              url: (
                <button className="text-accent hover:underline" onClick={() => void promptInstallFromUrl()}>
                  {t('plugins.haveUrlInstall')}
                </button>
              ),
              file: (
                <button className="text-accent hover:underline" onClick={() => void pickPluginFile()}>
                  {t('plugins.haveUrlFile')}
                </button>
              ),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
