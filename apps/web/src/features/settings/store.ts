import { create } from 'zustand';

export type SettingsSection =
  | 'profile'
  | 'appearance'
  | 'editor'
  | 'compiler'
  | 'pdf'
  | 'ai'
  | 'collab'
  | 'plugins'
  | 'shortcuts'
  | 'about';

const aliases: Record<string, SettingsSection> = {
  account: 'profile',
  user: 'profile',
  theme: 'appearance',
  language: 'appearance',
  compile: 'compiler',
  tex: 'compiler',
  viewer: 'pdf',
  agents: 'ai',
  mcp: 'ai',
  collaboration: 'collab',
  sharing: 'collab',
  plugin: 'plugins',
  keyboard: 'shortcuts',
  keybindings: 'shortcuts',
  keys: 'shortcuts',
  updates: 'about',
};

const valid = new Set<SettingsSection>(['profile', 'appearance', 'editor', 'compiler', 'pdf', 'ai', 'collab', 'plugins', 'shortcuts', 'about']);

export function resolveSection(id: unknown): SettingsSection | undefined {
  if (typeof id !== 'string') return undefined;
  const k = id.toLowerCase();
  return valid.has(k as SettingsSection) ? (k as SettingsSection) : aliases[k];
}

export const useSettingsUi = create<{
  open: boolean;
  section: SettingsSection;
  projectOpen: boolean;
  show(section?: SettingsSection): void;
  hide(): void;
  setSection(s: SettingsSection): void;
  setProjectOpen(open: boolean): void;
}>((set) => ({
  open: false,
  section: 'appearance',
  projectOpen: false,
  show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  hide: () => set({ open: false }),
  setSection: (section) => set({ section }),
  setProjectOpen: (projectOpen) => set({ projectOpen }),
}));
