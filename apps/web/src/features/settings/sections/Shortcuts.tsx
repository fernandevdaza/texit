import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useCommands } from '@/services/commands';
import { Input, Kbd, Switch } from '@/ui';
import { Highlight } from '@/ui/Highlight';
import { useLocale, useT } from '@/lib/i18n';
import { groupShortcuts } from '@/features/palette/shortcuts';

export function ShortcutsSection() {
  const commands = useCommands((s) => s.commands);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const t = useT();
  const locale = useLocale();
  const groups = useMemo(() => groupShortcuts(commands, q, { onlyBound: !all, locale }), [commands, q, all, locale]);
  const total = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <>
      <div className="sticky -top-6 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-3 bg-elevated px-1 pb-3 pt-1">
        <Input icon={<Search />} placeholder={t('settings.shortcuts.search')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <label className="flex items-center gap-2 text-[12px] text-fg-muted">
          <Switch size="sm" checked={all} onCheckedChange={setAll} />
          {t('settings.shortcuts.includeUnbound')}
        </label>
        <span className="ml-auto text-[11.5px] tabular-nums text-fg-subtle">{t('settings.shortcuts.shown', { count: total })}</span>
      </div>
      {groups.length === 0 && <p className="py-10 text-center text-[12.5px] text-fg-subtle">{t('settings.shortcuts.noMatch', { query: q })}</p>}
      {groups.map((g) => (
        <section key={g.category} className="mb-6">
          <h3 className="mb-2 px-0.5 text-[12px] font-semibold text-fg-muted">{g.label}</h3>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {g.entries.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.id} className="group flex h-10 items-center gap-3 px-4 text-[12.5px]">
                  <span className="flex size-4 shrink-0 items-center justify-center text-fg-subtle">{Icon && <Icon className="size-4" />}</span>
                  <Highlight text={e.title} positions={e.positions} className="min-w-0 flex-1 truncate text-fg" />
                  <span className="hidden font-mono text-[10.5px] text-fg-subtle/80 opacity-0 transition-opacity group-hover:opacity-100 md:inline">{e.builtin ? t('settings.shortcuts.editorBuiltin') : e.id}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {e.keys.length ? (
                      e.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-fg-subtle">/</span>}
                          <Kbd keys={k} />
                        </span>
                      ))
                    ) : (
                      <span className="text-fg-subtle/60">—</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="mt-2 text-[11.5px] text-fg-subtle">{t('settings.shortcuts.tip')}</p>
    </>
  );
}
