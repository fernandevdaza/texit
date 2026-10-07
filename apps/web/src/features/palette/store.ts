import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rememberFocus } from './focus';

export type PaletteMode = 'files' | 'commands' | 'symbols' | 'line' | 'help';

export const modePrefix: Record<PaletteMode, string> = {
  files: '',
  commands: '>',
  symbols: '@',
  line: ':',
  help: '?',
};

export function modeOf(query: string): PaletteMode {
  const c = query[0];
  if (c === '>') return 'commands';
  if (c === '@') return 'symbols';
  if (c === ':') return 'line';
  if (c === '?') return 'help';
  return 'files';
}

interface PaletteState {
  open: boolean;
  query: string;
  shortcutsOpen: boolean;
  /** Open the palette in a given mode (keeps the typed text when switching modes). */
  show(mode?: PaletteMode, text?: string): void;
  hide(): void;
  setQuery(q: string): void;
  setShortcutsOpen(open: boolean): void;
}

export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  query: '',
  shortcutsOpen: false,
  show(mode = 'files', text) {
    const cur = get();
    if (!cur.open) rememberFocus();
    const body = text ?? (cur.open ? cur.query.replace(/^[>@:?]/, '') : '');
    set({ open: true, query: modePrefix[mode] + body, shortcutsOpen: false });
  },
  hide() {
    set({ open: false });
  },
  setQuery(q) {
    set({ query: q });
  },
  setShortcutsOpen(open) {
    set({ shortcutsOpen: open, ...(open ? { open: false } : {}) });
  },
}));

/** Recently used commands and files (most recent first), persisted. */
interface HistoryState {
  commands: string[];
  files: Record<string, string[]>;
  pushCommand(id: string): void;
  pushFile(projectId: string, fileId: string): void;
}

export const usePaletteHistory = create<HistoryState>()(
  persist(
    (set) => ({
      commands: [],
      files: {},
      pushCommand: (id) => set((s) => ({ commands: [id, ...s.commands.filter((c) => c !== id)].slice(0, 30) })),
      pushFile: (projectId, fileId) =>
        set((s) => {
          const cur = s.files[projectId] ?? [];
          if (cur[0] === fileId) return s;
          const files = { ...s.files, [projectId]: [fileId, ...cur.filter((f) => f !== fileId)].slice(0, 30) };
          // Keep the map bounded.
          const keys = Object.keys(files);
          if (keys.length > 60) delete files[keys[0]!];
          return { files };
        }),
    }),
    { name: 'texit:palette', version: 1 },
  ),
);
