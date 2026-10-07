/** React adapter for plugin status-bar items (`api.ui.registerStatusItem`). */
import { useEffect, useState, type ComponentType } from 'react';
import type { PluginAPI, StatusItemDef } from '@texit/plugin-api';
import { Emitter } from '@/lib/emitter';
import { selectionChanged } from '@/services/editor';
import { useWorkspace } from '@/state/workspace';
import { StatusButton } from '@/features/workspace/StatusBar';
import { PanelIcon } from '@/features/workspace/PanelIcon';

export type SafeRun = <T>(fn: () => T, context: string) => T | undefined;

export function createStatusItemComponent(
  def: StatusItemDef,
  api: PluginAPI,
  run: SafeRun,
): { component: ComponentType; refresh(): void } {
  const refresh = new Emitter<void>();

  function PluginStatusItem() {
    const [, setTick] = useState(0);
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => setTick((x) => x + 1), 120);
      };
      let offContent: (() => void) | undefined;
      const attach = () => {
        offContent?.();
        offContent = useWorkspace.getState().project?.onContentChange(bump);
      };
      attach();
      const subs = [refresh.on(() => setTick((x) => x + 1)), selectionChanged.on(bump)];
      const unsub = useWorkspace.subscribe((s, p) => {
        if (s.project !== p.project) attach();
        if (s.activeFileId !== p.activeFileId || s.treeVersion !== p.treeVersion || s.project !== p.project) bump();
      });
      return () => {
        clearTimeout(timer);
        offContent?.();
        unsub();
        subs.forEach((d) => d.dispose());
      };
    }, []);

    const out = run(() => def.render({ api }), `status item "${def.id}"`);
    if (!out || !out.text) return null;
    return (
      <StatusButton
        title={out.tooltip}
        onClick={def.onClick ? () => run(() => def.onClick!(), `status item "${def.id}" click`) : undefined}
        className={def.onClick ? undefined : 'pointer-events-none'}
      >
        {out.icon && <PanelIcon icon={out.icon} className="size-3" />}
        <span className="tabular-nums">{out.text}</span>
      </StatusButton>
    );
  }
  PluginStatusItem.displayName = `PluginStatusItem(${def.id})`;
  return { component: PluginStatusItem, refresh: () => refresh.emit() };
}
