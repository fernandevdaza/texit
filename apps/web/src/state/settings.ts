/**
 * Global, persisted user settings (localStorage `texit:settings`).
 * Feature-specific settings (AI providers, collaboration, plugins) live in
 * their own persisted stores inside `features/<name>/`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { colorForName } from '@/ui/Misc';

export type ThemePref = 'system' | 'light' | 'dark';
export type AccentPreset = 'indigo' | 'violet' | 'blue' | 'teal' | 'emerald' | 'amber' | 'rose' | 'graphite';
export type Keymap = 'default' | 'vim' | 'emacs';

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  keymap: Keymap;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoCloseBrackets: boolean;
  autocomplete: boolean;
  spellcheck: boolean;
  highlightActiveLine: boolean;
  tabSize: number;
  /** Render \section, \textbf, math… with rich decorations (Texifier-like). */
  richText: boolean;
  /** Show inline math/equation previews on hover. */
  mathPreview: boolean;
  /** Fold-gutter and bracket matching. */
  foldGutter: boolean;
  /** Small inline lint (unbalanced braces, \begin/\end mismatch). */
  liveLint: boolean;
}

export interface CompileSettings {
  /** Recompile automatically after edits (debounced). */
  auto: boolean;
  autoDelayMs: number;
  /** 'auto' → native on desktop if TeX is installed, else WASM. */
  backend: 'auto' | 'busytex' | 'native' | 'remote' | string;
  remoteUrl: string;
  remoteToken: string;
  /** Optional TeX Live on-demand package server for the WASM engine. */
  texliveEndpoint: string;
  synctex: boolean;
  /** Use a single fast pass while typing; full build on explicit compile. */
  draftWhileTyping: boolean;
  shellEscape: boolean;
}

export interface PdfSettings {
  /** How to render the PDF in dark mode. */
  darkMode: 'off' | 'invert' | 'dim';
  defaultZoom: 'page-width' | 'page-fit' | 'auto';
  /** Scroll the PDF to the cursor location after each compile (forward SyncTeX). */
  followCursor: boolean;
  /** Double-click in PDF jumps to source. */
  doubleClickToSource: boolean;
}

export interface Settings {
  theme: ThemePref;
  accent: AccentPreset;
  /** Interface language. */
  locale: 'en' | 'es';
  userName: string;
  userColor: string;
  editor: EditorSettings;
  compile: CompileSettings;
  pdf: PdfSettings;
  /** Has the user completed the welcome tour? */
  onboarded: boolean;
}

const defaultName = (() => {
  const names = ['Ada', 'Grace', 'Emmy', 'Sofia', 'Alan', 'Donald', 'Leslie', 'Marie', 'Hypatia', 'Srinivasa', 'Katherine', 'Euler'];
  const n = names[Math.floor(Math.random() * names.length)];
  return `${n} ${Math.floor(Math.random() * 90 + 10)}`;
})();

export const defaultSettings: Settings = {
  theme: 'system',
  accent: 'indigo',
  locale: typeof navigator !== 'undefined' && navigator.language?.startsWith('es') ? 'es' : 'en',
  userName: defaultName,
  userColor: colorForName(defaultName),
  editor: {
    fontSize: 14,
    fontFamily: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
    lineHeight: 1.65,
    keymap: 'default',
    wordWrap: true,
    lineNumbers: true,
    autoCloseBrackets: true,
    autocomplete: true,
    spellcheck: true,
    highlightActiveLine: true,
    tabSize: 2,
    richText: true,
    mathPreview: true,
    foldGutter: true,
    liveLint: true,
  },
  compile: {
    auto: true,
    autoDelayMs: 1200,
    backend: 'auto',
    remoteUrl: '',
    remoteToken: '',
    texliveEndpoint: '',
    synctex: true,
    draftWhileTyping: false,
    shellEscape: false,
  },
  pdf: {
    darkMode: 'dim',
    defaultZoom: 'page-width',
    followCursor: false,
    doubleClickToSource: true,
  },
  onboarded: false,
};

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void;
  setEditor(patch: Partial<EditorSettings>): void;
  setCompile(patch: Partial<CompileSettings>): void;
  setPdf(patch: Partial<PdfSettings>): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      set: (patch) => set(patch),
      setEditor: (patch) => set((s) => ({ editor: { ...s.editor, ...patch } })),
      setCompile: (patch) => set((s) => ({ compile: { ...s.compile, ...patch } })),
      setPdf: (patch) => set((s) => ({ pdf: { ...s.pdf, ...patch } })),
      reset: () => set({ ...defaultSettings }),
    }),
    {
      name: 'texit:settings',
      version: 1,
      // Deep-merge nested sections so new defaults appear after upgrades.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return {
          ...current,
          ...p,
          editor: { ...current.editor, ...p.editor },
          compile: { ...current.compile, ...p.compile },
          pdf: { ...current.pdf, ...p.pdf },
        };
      },
    },
  ),
);

export const accentPresets: Record<AccentPreset, { light: string; dark: string; label: string }> = {
  indigo: { light: '#5b5bf0', dark: '#7c7cff', label: 'Indigo' },
  violet: { light: '#8b5cf6', dark: '#a78bfa', label: 'Violet' },
  blue: { light: '#2563eb', dark: '#60a5fa', label: 'Blue' },
  teal: { light: '#0d9488', dark: '#2dd4bf', label: 'Teal' },
  emerald: { light: '#059669', dark: '#34d399', label: 'Emerald' },
  amber: { light: '#d97706', dark: '#fbbf24', label: 'Amber' },
  rose: { light: '#e11d48', dark: '#fb7185', label: 'Rose' },
  graphite: { light: '#3f3f46', dark: '#d4d4d8', label: 'Graphite' },
};

/** Resolved light/dark theme (reactive). */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useResolvedTheme = create<{ theme: 'light' | 'dark' }>(() => ({ theme: resolveTheme(useSettings.getState().theme) }));

/** Keep <html class="dark"> and accent CSS variables in sync with settings. Call once at startup. */
export function initThemeSync() {
  // Persist the generated defaults (e.g. the random display name) so they stay stable across reloads.
  try {
    if (!localStorage.getItem('texit:settings')) useSettings.getState().set({ userName: useSettings.getState().userName });
  } catch {
    /* storage unavailable */
  }
  const apply = () => {
    const s = useSettings.getState();
    const theme = resolveTheme(s.theme);
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    const accent = accentPresets[s.accent] ?? accentPresets.indigo;
    const color = theme === 'dark' ? accent.dark : accent.light;
    root.style.setProperty('--tx-accent', color);
    root.style.setProperty('--tx-accent-hover', `color-mix(in srgb, ${color} 88%, ${theme === 'dark' ? 'white' : 'black'})`);
    root.style.setProperty('--tx-accent-soft', `color-mix(in srgb, ${color} ${theme === 'dark' ? 16 : 11}%, transparent)`);
    root.style.setProperty('--tx-accent-fg', s.accent === 'graphite' && theme === 'dark' ? '#111' : '#fff');
    if (useResolvedTheme.getState().theme !== theme) useResolvedTheme.setState({ theme });
  };
  apply();
  useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.accent !== prev.accent) apply();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
