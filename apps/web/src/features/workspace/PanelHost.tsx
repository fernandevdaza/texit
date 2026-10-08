import { useShallow } from 'zustand/react/shallow';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { usePanelRegistry, type PanelContribution } from '@/services/panels';
import { useLayout } from '@/state/workspace';
import { cn } from '@/lib/cn';
import { panelTitle, t as translate, useLocale, useT } from '@/lib/i18n';
import { EmptyState, IconButton } from '@/ui';
import { PanelIcon } from './PanelIcon';

/** Renders a panel contribution (React component or DOM renderer). */
export function PanelView({ panel }: { panel: PanelContribution }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel.render || !ref.current) return;
    const el = ref.current;
    let cleanup: void | (() => void);
    try {
      cleanup = panel.render(el);
    } catch (err) {
      el.textContent = translate('workspace.panelError', { error: String(err) });
    }
    return () => {
      try {
        cleanup?.();
      } finally {
        el.replaceChildren();
      }
    };
  }, [panel]);
  if (panel.component) {
    const C = panel.component;
    return <C />;
  }
  return <div ref={ref} className="h-full min-h-0 overflow-auto" />;
}

export function SidebarHost() {
  const panels = usePanelRegistry(useShallow((s) => s.panels.filter((p) => p.location === 'sidebar')));
  const active = useLayout((s) => s.sidebarPanel);
  const panel = panels.find((p) => p.id === active) ?? panels[0];
  const t = useT();
  if (!panel) return <EmptyState title={t('workspace.noPanels')} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelView key={panel.id} panel={panel} />
    </div>
  );
}

export function BottomHost() {
  const panels = usePanelRegistry(useShallow((s) => s.panels.filter((p) => p.location === 'bottom')));
  usePanelRegistry((s) => s.badgeVersion);
  const { bottomPanel, set } = useLayout();
  const t = useT();
  const locale = useLocale();
  const panel = panels.find((p) => p.id === bottomPanel) ?? panels[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        {panels.map((p) => {
          const badge = p.badge?.();
          return (
            <button
              key={p.id}
              onClick={() => set({ bottomPanel: p.id })}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors',
                p.id === panel?.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <PanelIcon icon={p.icon} className="size-3.5" />
              {panelTitle(p, locale)}
              {badge ? <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-fg-muted ring-1 ring-border">{badge}</span> : null}
            </button>
          );
        })}
        <div className="flex-1" />
        <IconButton label={t('workspace.closePanel')} shortcut="Mod-j" size="xs" onClick={() => set({ bottomOpen: false })}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">{panel && <PanelView key={panel.id} panel={panel} />}</div>
    </div>
  );
}
