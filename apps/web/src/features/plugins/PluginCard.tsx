/** Plugin cards, registry cards and the details/settings dialog. */
import { useEffect, useState } from 'react';
import { CircleAlert, Download, ExternalLink, MoreHorizontal, RefreshCw, RotateCw, Settings2, Trash2 } from 'lucide-react';
import type { PluginSettingDef } from '@texit/plugin-api';
import { cn } from '@/lib/cn';
import { Badge, Button, DropdownMenu, IconButton, Input, Select, SettingRow, Spinner, Switch, Textarea, openModal } from '@/ui';
import { PermissionList, PluginIconTile } from './appUi';
import { getEntry, setPluginEnabled, usePlugins, type PluginEntry } from './manager';
import { getSettingsHandle } from './settingsStore';
import { confirmUninstall, installRegistryEntry, reloadWithToast } from './actions';
import { compareVersions, type RegistryEntry } from './registry';

const SOURCE_LABEL: Record<PluginEntry['source'], string> = { builtin: 'Built-in', url: 'URL', file: 'Local file', registry: 'Registry' };

export function StatusDot({ entry }: { entry: PluginEntry }) {
  const tone =
    entry.status === 'error' || entry.lastError
      ? 'bg-danger'
      : entry.status === 'active'
        ? 'bg-success'
        : entry.status === 'activating'
          ? 'bg-warning animate-pulse'
          : 'bg-border-strong';
  const label = entry.status === 'error' ? 'Failed to start' : entry.lastError ? 'Active, with errors' : entry.status;
  return <span title={label} className={cn('inline-block size-1.5 shrink-0 rounded-full', tone)} />;
}

export function pluginMenu(entry: PluginEntry) {
  return [
    { label: 'Details & settings', icon: <Settings2 />, onSelect: () => openPluginDetails(entry.id) },
    { label: 'Reload', icon: <RotateCw />, disabled: !entry.enabled, onSelect: () => void reloadWithToast(entry.id) },
    ...(entry.manifest.homepage ? [{ label: 'Homepage', icon: <ExternalLink />, onSelect: () => window.open(entry.manifest.homepage, '_blank', 'noopener') }] : []),
    ...(entry.builtin ? [] : [{ type: 'separator' as const }, { label: 'Uninstall', icon: <Trash2 />, danger: true, onSelect: () => void confirmUninstall(entry.id) }]),
  ];
}

export function ErrorNote({ entry, compact }: { entry: PluginEntry; compact?: boolean }) {
  const msg = entry.status === 'error' ? entry.error : entry.lastError ? `${entry.lastError.context}: ${entry.lastError.message}` : null;
  if (!msg) return null;
  return (
    <div className={cn('flex items-start gap-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-[11.5px] leading-snug text-danger', compact && 'py-1')}>
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span className="line-clamp-3 min-w-0 flex-1 break-words">{msg}</span>
      {entry.enabled && (
        <button className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={() => void reloadWithToast(entry.id)}>
          Reload
        </button>
      )}
    </div>
  );
}

export function PluginCard({ entry }: { entry: PluginEntry }) {
  const m = entry.manifest;
  return (
    <div
      className={cn(
        'group rounded-xl border border-border bg-surface p-2.5 shadow-xs transition-colors hover:border-border-strong',
        !entry.enabled && 'bg-surface-2/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn(!entry.enabled && 'opacity-60 grayscale')}>
          <PluginIconTile icon={m.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button className="truncate text-left text-[13px] font-semibold text-fg hover:underline" onClick={() => openPluginDetails(entry.id)}>
              {m.name}
            </button>
            <StatusDot entry={entry} />
          </div>
          <div className="truncate text-[11px] text-fg-subtle">
            v{m.version}
            {m.author ? ` · ${m.author}` : ''}
            {entry.builtin ? ' · Built-in' : ''}
          </div>
        </div>
        <Switch size="sm" checked={entry.enabled} onCheckedChange={(v) => void setPluginEnabled(entry.id, v)} />
      </div>
      {m.description && <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-fg-muted">{m.description}</p>}
      {(entry.status === 'error' || entry.lastError) && (
        <div className="mt-2">
          <ErrorNote entry={entry} compact />
        </div>
      )}
      <div className="mt-1.5 flex h-6 items-center gap-0.5">
        {entry.status === 'activating' && <Spinner className="mr-1 size-3 text-fg-subtle" />}
        <div className="flex flex-1 flex-wrap gap-1 overflow-hidden">
          {(m.tags ?? []).slice(0, 3).map((t) => (
            <span key={t} className="rounded bg-surface-2 px-1.5 text-[10.5px] leading-[18px] text-fg-subtle">
              {t}
            </span>
          ))}
        </div>
        <IconButton label="Settings" size="xs" onClick={() => openPluginDetails(entry.id)} className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
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
      </div>
    </div>
  );
}

export function RegistryCard({ item }: { item: RegistryEntry }) {
  const installed = usePlugins((s) => s.entries[item.id]);
  const [busy, setBusy] = useState(false);
  const update = installed && !installed.builtin && compareVersions(item.version, installed.manifest.version) > 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-2.5 shadow-xs">
      <div className="flex items-start gap-2.5">
        <PluginIconTile icon={item.icon} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-fg">{item.name}</div>
          <div className="truncate text-[11px] text-fg-subtle">
            v{item.version}
            {item.author ? ` · ${item.author}` : ''}
          </div>
        </div>
        {installed && !update ? (
          <Badge tone="success">Installed</Badge>
        ) : (
          <Button
            size="xs"
            variant={update ? 'subtle' : 'primary'}
            loading={busy}
            icon={update ? <RefreshCw /> : <Download />}
            onClick={async () => {
              setBusy(true);
              try {
                await installRegistryEntry(item);
              } finally {
                setBusy(false);
              }
            }}
          >
            {update ? 'Update' : 'Install'}
          </Button>
        )}
      </div>
      {item.description && <p className="mt-1.5 line-clamp-3 text-[12px] leading-snug text-fg-muted">{item.description}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {(item.tags ?? []).slice(0, 4).map((t) => (
          <span key={t} className="rounded bg-surface-2 px-1.5 text-[10.5px] leading-[18px] text-fg-subtle">
            {t}
          </span>
        ))}
        {item.homepage && (
          <a href={item.homepage} target="_blank" rel="noreferrer noopener" className="ml-auto text-[11px] text-accent hover:underline">
            Homepage
          </a>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── details dialog ─────────────────────────────

function SettingControl({ def, pluginId }: { def: PluginSettingDef; pluginId: string }) {
  const entry = getEntry(pluginId)!;
  const handle = getSettingsHandle(pluginId, entry.manifest);
  const [value, setValue] = useState<unknown>(() => handle.get(def.key, def.default));
  useEffect(() => {
    if (!handle.loaded) void handle.load().then(() => setValue(handle.get(def.key, def.default)));
    const d = handle.onDidChange((k, v) => k === def.key && setValue(v));
    return () => d.dispose();
  }, [handle, def.key, def.default]);
  const set = (v: unknown) => {
    setValue(v);
    handle.set(def.key, v);
  };
  switch (def.type) {
    case 'boolean':
      return <Switch checked={!!value} onCheckedChange={set} />;
    case 'select':
      return <Select size="sm" value={String(value ?? '')} onValueChange={set} options={(def.options ?? []).map((o) => ({ value: o.value, label: o.label }))} className="w-44" />;
    case 'number':
      return (
        <Input
          inputSize="sm"
          type="number"
          className="w-24 text-right tabular-nums"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value == null ? '' : String(value)}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'text':
      return <Textarea className="w-64 text-[12px]" value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => set(e.target.value)} />;
    default:
      return <Input inputSize="sm" className="w-52" value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => set(e.target.value)} />;
  }
}

function PluginDetails({ id, close }: { id: string; close: () => void }) {
  const entry = usePlugins((s) => s.entries[id]);
  const [, force] = useState(0);
  if (!entry) return <p className="py-6 text-center text-[12.5px] text-fg-subtle">This plugin was uninstalled.</p>;
  const m = entry.manifest;
  const settings = m.settings ?? [];
  return (
    <div className="space-y-4 pb-1">
      <div className="flex items-start gap-3">
        <PluginIconTile icon={m.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold text-fg">{m.name}</span>
            <Badge>v{m.version}</Badge>
            <Badge tone={entry.builtin ? 'accent' : 'neutral'}>{SOURCE_LABEL[entry.source]}</Badge>
            <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <StatusDot entry={entry} /> {entry.status}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-fg-subtle">
            {m.author ? `${m.author} · ` : ''}
            <span className="font-mono">{m.id}</span>
          </div>
          {entry.url && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle" title={entry.url}>
              {entry.url}
            </div>
          )}
        </div>
        <Switch checked={entry.enabled} onCheckedChange={(v) => void setPluginEnabled(id, v)} />
      </div>
      {m.description && <p className="text-[12.5px] leading-relaxed text-fg-muted">{m.description}</p>}
      <ErrorNote entry={entry} />

      {settings.length > 0 && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Settings</h3>
            <button
              className="text-[11.5px] text-fg-subtle hover:text-fg"
              onClick={() => {
                getSettingsHandle(id, m).reset();
                force((x) => x + 1);
              }}
            >
              Reset to defaults
            </button>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border px-3">
            {settings.map((s) => (
              <SettingRow key={s.key} title={s.title} description={s.description} className="py-2.5">
                <SettingControl def={s} pluginId={id} />
              </SettingRow>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Permissions {entry.builtin && <span className="font-normal normal-case tracking-normal">(built-in plugins are trusted)</span>}
        </h3>
        <PermissionList permissions={m.permissions} />
      </section>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex gap-1.5">
          {!entry.builtin && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:bg-danger-soft hover:text-danger"
              icon={<Trash2 />}
              onClick={async () => {
                await confirmUninstall(id);
                if (!getEntry(id)) close();
              }}
            >
              Uninstall
            </Button>
          )}
          {m.homepage && (
            <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => window.open(m.homepage, '_blank', 'noopener')}>
              Homepage
            </Button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" icon={<RotateCw />} disabled={!entry.enabled} onClick={() => void reloadWithToast(id)}>
            Reload
          </Button>
          <Button size="sm" variant="primary" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export function openPluginDetails(id: string) {
  const e = getEntry(id);
  if (!e) return;
  void openModal({ title: "Plugin details", width: 'max-w-xl', render: (close) => <PluginDetails id={id} close={close} /> });
}
