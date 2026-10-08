/**
 * Imperative cmdk-style picker: `await quickPick(items, { placeholder })`.
 * Self-mounting (own React root) so it works from anywhere — plugins,
 * commands, other dialogs — without a host component.
 */
import { useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { Search } from 'lucide-react';
import { useT } from '@/lib/i18n';

export interface QuickPickOption<T> {
  label: string;
  description?: string;
  /** Right-aligned hint (e.g. a shortcut or a path). */
  hint?: string;
  icon?: ReactNode;
  value: T;
  keywords?: string[];
}

export interface QuickPickOptions {
  placeholder?: string;
  title?: string;
  emptyText?: string;
}

export function quickPick<T>(items: QuickPickOption<T>[], opts: QuickPickOptions = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.dataset.texitQuickpick = '';
    document.body.append(el);
    const root = createRoot(el);
    let settled = false;
    const done = (v: T | undefined) => {
      if (settled) return;
      settled = true;
      resolve(v);
      setTimeout(() => {
        root.unmount();
        el.remove();
      }, 0);
    };
    root.render(<QuickPickView items={items} opts={opts} onDone={done} />);
  });
}

function QuickPickView<T>({ items, opts, onDone }: { items: QuickPickOption<T>[]; opts: QuickPickOptions; onDone: (v: T | undefined) => void }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = (v: T | undefined) => {
    setOpen(false);
    onDone(v);
  };
  return (
    <D.Root open={open} onOpenChange={(o) => !o && close(undefined)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[80] animate-fade-in bg-black/20 dark:bg-black/45" />
        <D.Content
          className="fixed left-1/2 top-[13vh] z-[80] w-[min(580px,calc(100vw-32px))] -translate-x-1/2 animate-scale-in overflow-hidden rounded-xl border border-border bg-elevated text-fg shadow-2xl outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <D.Title className="sr-only">{opts.title ?? opts.placeholder ?? t('ui.pickItem')}</D.Title>
          <Command loop className="flex flex-col">
            {opts.title && (
              <div className="border-b border-border px-3.5 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                {opts.title}
              </div>
            )}
            <div className="flex items-center gap-2 border-b border-border px-3.5">
              <Search className="size-4 shrink-0 text-fg-subtle" />
              <Command.Input
                ref={inputRef}
                autoFocus
                placeholder={opts.placeholder ?? t('ui.typeToFilter')}
                className="h-11 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <Command.List className="max-h-[min(400px,60vh)] overflow-y-auto overscroll-contain p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[12.5px] text-fg-subtle">{opts.emptyText ?? t('ui.noMatches')}</Command.Empty>
              {items.map((it, i) => (
                <Command.Item
                  key={i}
                  value={`${it.label}\u0000${i}`}
                  keywords={[it.description ?? '', it.hint ?? '', ...(it.keywords ?? [])]}
                  onSelect={() => close(it.value)}
                  className="flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-fg data-[selected=true]:bg-accent-soft [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {it.icon && <span className="flex w-5 items-center justify-center text-fg-muted">{it.icon}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{it.label}</div>
                    {it.description && <div className="truncate text-[11.5px] text-fg-subtle">{it.description}</div>}
                  </div>
                  {it.hint && <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{it.hint}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
