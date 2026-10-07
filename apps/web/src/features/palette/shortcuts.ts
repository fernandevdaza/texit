import type { LucideIcon } from 'lucide-react';
import type { Command } from '@/services/commands';
import { fuzzyWords } from './fuzzy';

export interface ShortcutEntry {
  id: string;
  title: string;
  category: string;
  keys: string[];
  icon?: LucideIcon;
  /** Built into the editor (CodeMirror), not a registered command. */
  builtin?: boolean;
  positions?: number[];
}

/** Standard CodeMirror bindings worth knowing (not registered as commands). */
export const editorBuiltins: ShortcutEntry[] = [
  { id: 'cm.find', title: 'Find / replace in file', category: 'Editor', keys: ['Mod-f'], builtin: true },
  { id: 'cm.comment', title: 'Toggle comment', category: 'Editor', keys: ['Mod-/'], builtin: true },
  { id: 'cm.nextOccurrence', title: 'Select next occurrence', category: 'Editor', keys: ['Mod-d'], builtin: true },
  { id: 'cm.moveLine', title: 'Move line up / down', category: 'Editor', keys: ['Alt-ArrowUp', 'Alt-ArrowDown'], builtin: true },
  { id: 'cm.copyLine', title: 'Duplicate line', category: 'Editor', keys: ['Shift-Alt-ArrowDown'], builtin: true },
  { id: 'cm.indent', title: 'Indent / outdent', category: 'Editor', keys: ['Mod-]', 'Mod-['], builtin: true },
  { id: 'cm.undo', title: 'Undo / redo', category: 'Editor', keys: ['Mod-z', 'Mod-Shift-z'], builtin: true },
];

const order = ['Project', 'File', 'Edit', 'Editor', 'Insert', 'Format', 'View', 'Compile', 'PDF', 'AI', 'Collaboration', 'History', 'Plugins', 'Preferences', 'Help'];

export function groupShortcuts(
  commands: Record<string, Command>,
  query: string,
  opts: { onlyBound?: boolean; includeBuiltins?: boolean } = {},
): { category: string; entries: ShortcutEntry[] }[] {
  const { onlyBound = true, includeBuiltins = true } = opts;
  const bound = new Set<string>();
  const entries: ShortcutEntry[] = [];
  for (const c of Object.values(commands)) {
    if (c.hidden && !c.keybinding) continue;
    if (onlyBound && !c.keybinding) continue;
    const keys = c.keybinding ? c.keybinding.split(/\s*\|\s*/) : [];
    keys.forEach((k) => bound.add(k.toLowerCase()));
    entries.push({ id: c.id, title: c.title, category: c.category ?? 'Other', keys, icon: c.icon });
  }
  if (includeBuiltins) {
    for (const b of editorBuiltins) {
      // Skip a builtin when a command already claims the same binding.
      if (b.keys.some((k) => bound.has(k.toLowerCase()) && k !== 'Mod-/')) continue;
      entries.push(b);
    }
  }
  const q = query.trim();
  const filtered = q
    ? entries
        .map((e) => {
          const r = fuzzyWords(q, e.title) ?? fuzzyWords(q, `${e.title} ${e.category} ${e.id} ${e.keys.join(' ')}`);
          return r ? { ...e, positions: r.positions.filter((p) => p < e.title.length), score: r.score } : null;
        })
        .filter(Boolean)
    : entries;
  const map = new Map<string, ShortcutEntry[]>();
  for (const e of filtered as ShortcutEntry[]) {
    if (!map.has(e.category)) map.set(e.category, []);
    map.get(e.category)!.push(e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    })
    .map(([category, list]) => ({ category, entries: q ? list : list.sort((a, b) => a.title.localeCompare(b.title)) }));
}
