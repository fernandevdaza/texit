import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Emitter } from '@/lib/emitter';

export type DashSection = 'all' | 'recent' | 'starred' | 'shared' | 'trash' | `tag:${string}`;
export type SortKey = 'opened' | 'modified' | 'name' | 'created';
export type ViewMode = 'grid' | 'list';

/** Persisted dashboard preferences. */
export const useDashboardPrefs = create<{
  view: ViewMode;
  sort: SortKey;
  setView(v: ViewMode): void;
  setSort(s: SortKey): void;
}>()(
  persist(
    (set) => ({
      view: 'grid',
      sort: 'opened',
      setView: (view) => set({ view }),
      setSort: (sort) => set({ sort }),
    }),
    { name: 'texit:dashboard', version: 1 },
  ),
);

/** Transient UI state shared by the dashboard, its dialogs and the commands. */
export const useDashboardUi = create<{
  newProject: { open: boolean; templateId?: string };
  joinOpen: boolean;
  tagsFor: string | null;
  renaming: string | null;
  openNewProject(templateId?: string): void;
  closeNewProject(): void;
  setJoinOpen(open: boolean): void;
  setTagsFor(id: string | null): void;
  setRenaming(id: string | null): void;
}>((set) => ({
  newProject: { open: false },
  joinOpen: false,
  tagsFor: null,
  renaming: null,
  openNewProject: (templateId) => set({ newProject: { open: true, templateId } }),
  closeNewProject: () => set((s) => ({ newProject: { ...s.newProject, open: false } })),
  setJoinOpen: (joinOpen) => set({ joinOpen }),
  setTagsFor: (tagsFor) => set({ tagsFor }),
  setRenaming: (renaming) => set({ renaming }),
}));

/** Fired by the `dashboard.search` command (⌘K / ⌘F on the dashboard). */
export const focusSearch = new Emitter<void>();

/** Dashboard search query (shared by header and grid). */
export const useDashboardSearch = create<{ query: string; setQuery(q: string): void }>((set) => ({ query: '', setQuery: (query) => set({ query }) }));
