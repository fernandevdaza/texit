/**
 * Command palette feature: ⌘⇧P (commands), ⌘P (quick open), `@` symbols,
 * `:` go to line, `?` help, and the ⌘/ shortcuts cheat sheet.
 */
import { CircleQuestionMark, Hash, Keyboard, ListOrdered, Search, SquareTerminal } from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { useWorkspace } from '@/state/workspace';
import { usePalette, usePaletteHistory, type PaletteMode } from './store';


const inProject = () => !!useWorkspace.getState().project;
const inEditor = () => !!(document.activeElement as HTMLElement | null)?.closest?.('.cm-editor');

function toggle(mode: PaletteMode) {
  usePalette.getState().show(mode);
}

export function activate() {
  const d = registerCommands([
    {
      id: 'view.commandPalette',
      title: 'Show all commands',
      category: 'View',
      icon: SquareTerminal,
      keybinding: 'Mod-Shift-p',
      global: true,
      keywords: ['palette', 'command', 'actions'],
      run: () => toggle('commands'),
    },
    {
      id: 'view.quickOpen',
      title: 'Go to file…',
      category: 'View',
      icon: Search,
      keybinding: 'Mod-p',
      global: true,
      keywords: ['quick open', 'open file', 'switch project'],
      run: () => toggle('files'),
    },
    {
      id: 'view.goToSymbol',
      title: 'Go to section or label…',
      category: 'View',
      icon: Hash,
      when: inProject,
      keywords: ['symbol', 'outline', 'heading', 'label', 'frame'],
      run: () => toggle('symbols'),
    },
    {
      id: 'view.goToLine',
      title: 'Go to line…',
      category: 'View',
      icon: ListOrdered,
      when: inProject,
      run: () => toggle('line'),
    },
    {
      id: 'help.palette',
      title: 'Command palette help',
      category: 'Help',
      icon: CircleQuestionMark,
      run: () => toggle('help'),
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard shortcuts',
      category: 'Help',
      icon: Keyboard,
      keybinding: 'Mod-/',
      global: true,
      // Inside the editor ⌘/ toggles comments (CodeMirror); everywhere else it opens the cheat sheet.
      when: () => !inEditor(),
      keywords: ['cheat sheet', 'keybindings', 'hotkeys'],
      run: () => usePalette.getState().setShortcutsOpen(!usePalette.getState().shortcutsOpen),
    },
  ]);

  // Track recently opened files per project (quick-open ordering).
  const unsub = useWorkspace.subscribe((s, prev) => {
    if (s.activeFileId && s.activeFileId !== prev.activeFileId && s.session) {
      usePaletteHistory.getState().pushFile(s.session.id, s.activeFileId);
    }
  });

  return () => {
    d.dispose();
    unsub();
  };
}
