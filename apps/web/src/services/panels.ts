/**
 * Panel & status-bar registries. Built-in features and plugins contribute
 * panels to the sidebar (activity bar), the bottom area and the right dock.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import type { Disposable } from '@texit/core';

export type PanelLocation = 'sidebar' | 'bottom' | 'right';

export interface PanelContribution {
  id: string;
  title: string;
  location: PanelLocation;
  /** Lucide icon component, or a lucide icon name / inline SVG string (plugins). */
  icon?: LucideIcon | string;
  /** Lower comes first. Built-ins use 0–100. */
  order?: number;
  /** React panel… */
  component?: ComponentType;
  /** …or a framework-agnostic renderer (plugins). Return a cleanup. */
  render?: (container: HTMLElement) => void | (() => void);
  /** Small count/dot shown on the activity-bar icon / tab. */
  badge?: () => number | string | null;
  /** Owner plugin id (for uninstall). */
  pluginId?: string;
}

export interface StatusItemContribution {
  id: string;
  align: 'left' | 'right';
  order?: number;
  component: ComponentType;
  pluginId?: string;
}

interface RegistryState {
  panels: PanelContribution[];
  statusItems: StatusItemContribution[];
  /** Bumped by `refreshBadges()` so activity-bar / tab badges re-render. */
  badgeVersion: number;
}

export const usePanelRegistry = create<RegistryState>(() => ({ panels: [], statusItems: [], badgeVersion: 0 }));

/** Call when a panel's `badge()` value may have changed. */
export function refreshBadges() {
  usePanelRegistry.setState((s) => ({ badgeVersion: s.badgeVersion + 1 }));
}

export function registerPanel(panel: PanelContribution): Disposable {
  usePanelRegistry.setState((s) => ({
    panels: [...s.panels.filter((p) => p.id !== panel.id), panel].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
  }));
  return {
    dispose: () => usePanelRegistry.setState((s) => ({ panels: s.panels.filter((p) => p !== panel) })),
  };
}

export function registerStatusItem(item: StatusItemContribution): Disposable {
  usePanelRegistry.setState((s) => ({
    statusItems: [...s.statusItems.filter((p) => p.id !== item.id), item].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
  }));
  return {
    dispose: () => usePanelRegistry.setState((s) => ({ statusItems: s.statusItems.filter((p) => p !== item) })),
  };
}
