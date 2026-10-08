import { useMemo, useState } from 'react';
import { Keyboard, Search } from 'lucide-react';
import { useCommands } from '@/services/commands';
import { Dialog, Input, Kbd } from '@/ui';
import { Highlight } from '@/ui/Highlight';
import { useLocale, useT } from '@/lib/i18n';
import { usePalette } from './store';
import { groupShortcuts } from './shortcuts';

/** `help.shortcuts` (⌘/): a searchable cheat sheet grouped by category. */
export function ShortcutsSheet() {
  const open = usePalette((s) => s.shortcutsOpen);
  const setOpen = usePalette((s) => s.setShortcutsOpen);
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('palette.shortcuts.title')}
      description={t('palette.shortcuts.description')}
      icon={<Keyboard />}
      width="max-w-[980px]"
      bodyClassName="px-0 pb-0 pt-2"
    >
      {open && <SheetBody />}
    </Dialog>
  );
}

function SheetBody() {
  const commands = useCommands((s) => s.commands);
  const [q, setQ] = useState('');
  const t = useT();
  const locale = useLocale();
  const groups = useMemo(() => groupShortcuts(commands, q, { locale }), [commands, q, locale]);
  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-5 pb-3">
        <Input autoFocus icon={<Search />} placeholder={t('palette.shortcuts.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border bg-surface-2/40 px-5 py-4">
        {groups.length === 0 ? (
          <p className="py-10 text-center text-[12.5px] text-fg-subtle">{t('palette.shortcuts.noMatch', { query: q })}</p>
        ) : (
          <div className="gap-4 [column-fill:_balance] sm:columns-2 lg:columns-3">
            {groups.map((g) => (
              <section key={g.category} className="mb-4 break-inside-avoid rounded-xl border border-border bg-surface p-1.5 shadow-xs">
                <h3 className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">{g.label}</h3>
                {g.entries.map((e) => (
                  <div key={e.id} className="flex min-h-8 items-center justify-between gap-3 rounded-md px-2 py-1 text-[12.5px] hover:bg-hover">
                    <Highlight text={e.title} positions={e.positions} className="min-w-0 text-fg" />
                    <span className="flex shrink-0 items-center gap-1">
                      {e.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-fg-subtle">/</span>}
                          <Kbd keys={k} />
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
