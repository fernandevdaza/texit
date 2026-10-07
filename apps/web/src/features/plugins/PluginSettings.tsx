/** Plugin management section rendered inside the global Settings dialog (dense layout). */
import { useState } from 'react';
import { Download, FileUp, Link2, MoreHorizontal, Search, Settings2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, Button, DropdownMenu, IconButton, Input, Segmented, SettingRow, Switch } from '@/ui';
import { PluginIconTile } from './appUi';
import { setPluginEnabled, type PluginEntry } from './manager';
import { DEFAULT_REGISTRY_URL, usePluginPrefs } from './registry';
import { pickPluginFile, promptInstallFromUrl } from './actions';
import { ErrorNote, RegistryCard, StatusDot, openPluginDetails, pluginMenu } from './PluginCard';
import { useFilteredPlugins, useRegistryEntries } from './PluginsPanel';

function Row({ entry }: { entry: PluginEntry }) {
  const m = entry.manifest;
  return (
    <div className="py-2">
      <div className="flex items-center gap-3">
        <div className={cn(!entry.enabled && 'opacity-60 grayscale')}>
          <PluginIconTile icon={m.icon} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-fg">{m.name}</span>
            <span className="text-[11px] text-fg-subtle">v{m.version}</span>
            {entry.builtin && <Badge>Built-in</Badge>}
            <StatusDot entry={entry} />
          </div>
          <div className="truncate text-[11.5px] text-fg-subtle">{m.description}</div>
        </div>
        <IconButton label="Details & settings" size="xs" onClick={() => openPluginDetails(entry.id)}>
          <Settings2 />
        </IconButton>
        <DropdownMenu
          align="end"
          items={pluginMenu(entry)}
          trigger={
            <button aria-label="More actions" className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        />
        <Switch size="sm" checked={entry.enabled} onCheckedChange={(v) => void setPluginEnabled(entry.id, v)} />
      </div>
      {(entry.status === 'error' || entry.lastError) && (
        <div className="ml-10 mt-1.5">
          <ErrorNote entry={entry} compact />
        </div>
      )}
    </div>
  );
}

export function PluginSettings() {
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [query, setQuery] = useState('');
  const list = useFilteredPlugins(query);
  const registry = useRegistryEntries(tab === 'browse' ? query : '');
  const { devMode, registryUrl, set } = usePluginPrefs();
  const [url, setUrl] = useState('');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'installed', label: `Installed (${list.length})` },
            { value: 'browse', label: 'Browse registry' },
          ]}
        />
        <div className="min-w-40 flex-1">
          <Input inputSize="sm" icon={<Search />} placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button size="sm" icon={<FileUp />} onClick={() => void pickPluginFile()}>
          From file…
        </Button>
      </div>

      {tab === 'installed' ? (
        <div className="divide-y divide-border">
          {list.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
          {!list.length && <p className="py-6 text-center text-[12.5px] text-fg-subtle">No plugins match “{query}”.</p>}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {registry.error && <p className="text-[12.5px] text-danger">{registry.error}</p>}
          {registry.items.map((e) => (
            <RegistryCard key={e.id} item={e} />
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void promptInstallFromUrl(url.trim()).then(() => setUrl(''));
        }}
      >
        <Input inputSize="sm" icon={<Link2 />} placeholder="https://… plugin module URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button size="sm" variant="primary" type="submit" icon={<Download />} disabled={!url.trim()}>
          Install
        </Button>
      </form>

      <div className="divide-y divide-border border-t border-border">
        <SettingRow
          title="Developer mode"
          description="Reload plugins installed from a URL whenever the TexIt window regains focus and their source changed — handy with a local static server."
        >
          <Switch checked={devMode} onCheckedChange={(v) => set({ devMode: v })} />
        </SettingRow>
        <SettingRow title="Registry URL" description="Where “Browse” loads the plugin list from.">
          <div className="flex items-center gap-1.5">
            <Input inputSize="sm" className="w-64 font-mono text-[11.5px]" value={registryUrl} onChange={(e) => set({ registryUrl: e.target.value })} />
            {registryUrl !== DEFAULT_REGISTRY_URL && (
              <Button size="xs" variant="ghost" onClick={() => set({ registryUrl: DEFAULT_REGISTRY_URL })}>
                Reset
              </Button>
            )}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
