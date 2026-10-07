import { ContextMenu as CM, DropdownMenu as DM } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Kbd } from './Kbd';

/** Data-driven menu entries shared by dropdown and context menus. */
export type MenuEntry =
  | {
      type?: 'item';
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      hint?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect?: () => void;
      submenu?: MenuEntry[];
    }
  | { type: 'separator' }
  | { type: 'label'; label: ReactNode };

const contentCls =
  'z-[90] min-w-[200px] max-w-[320px] animate-scale-in overflow-hidden rounded-lg border border-border bg-elevated p-1 text-[12.5px] text-fg shadow-pop outline-none';
const itemCls =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg data-[disabled]:opacity-40 [&_svg]:size-[15px] [&_svg]:shrink-0';

type Prims = typeof DM | typeof CM;

function renderEntries(P: Prims, entries: MenuEntry[]): ReactNode {
  return entries.map((e, i) => {
    if (e.type === 'separator') return <P.Separator key={i} className="-mx-1 my-1 h-px bg-border" />;
    if (e.type === 'label')
      return (
        <P.Label key={i} className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">
          {e.label}
        </P.Label>
      );
    if (e.submenu) {
      return (
        <P.Sub key={i}>
          <P.SubTrigger className={cn(itemCls, 'data-[state=open]:bg-hover')} disabled={e.disabled}>
            <span className="flex w-4 justify-center text-fg-muted group-data-[highlighted]:text-current">{e.icon}</span>
            <span className="flex-1 truncate">{e.label}</span>
            <ChevronRight className="ml-auto opacity-60" />
          </P.SubTrigger>
          <P.Portal>
            <P.SubContent className={contentCls} sideOffset={4} alignOffset={-4}>
              {renderEntries(P, e.submenu)}
            </P.SubContent>
          </P.Portal>
        </P.Sub>
      );
    }
    return (
      <P.Item
        key={i}
        disabled={e.disabled}
        onSelect={() => e.onSelect?.()}
        className={cn(itemCls, 'group', e.danger && 'text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white')}
      >
        <span className="flex w-4 items-center justify-center opacity-75 group-data-[highlighted]:opacity-100">
          {e.checked ? <Check /> : e.icon}
        </span>
        <span className="flex-1 truncate">{e.label}</span>
        {e.hint && <span className="text-[11px] opacity-60">{e.hint}</span>}
        {e.shortcut && <Kbd keys={e.shortcut} className="ml-3 opacity-80 group-data-[highlighted]:[&_kbd]:border-white/20 group-data-[highlighted]:[&_kbd]:bg-white/15 group-data-[highlighted]:[&_kbd]:text-white" />}
      </P.Item>
    );
  });
}

export function DropdownMenu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  className,
  onOpenChange,
}: {
  trigger: ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DM.Root modal={false} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} side={side} sideOffset={6} collisionPadding={8} className={cn(contentCls, className)}>
          {renderEntries(DM, items)}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function ContextMenu({
  children,
  items,
  disabled,
  onOpenChange,
}: {
  children: ReactNode;
  /** Entries, or a function evaluated lazily when the menu opens. */
  items: MenuEntry[] | (() => MenuEntry[]);
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CM.Root modal={false} onOpenChange={onOpenChange}>
      <CM.Trigger asChild disabled={disabled}>
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content collisionPadding={8} className={contentCls}>
          {renderEntries(CM, typeof items === 'function' ? items() : items)}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
