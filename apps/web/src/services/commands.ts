/**
 * Command registry: every user-facing action (menus, command palette, native
 * menu, keybindings, plugins) is a command.
 */
import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import type { Disposable } from '@texit/core';
import { matchesKeybinding } from '@/lib/platform';

export interface Command {
  id: string;
  title: string;
  /** Group shown in the command palette (e.g. 'File', 'View', 'Compile', 'AI'). */
  category?: string;
  icon?: LucideIcon;
  /** CodeMirror notation, e.g. 'Mod-Shift-p'. */
  keybinding?: string;
  /**
   * When true the keybinding is handled globally (capture phase), even while
   * the editor has focus. Editor-only bindings should be registered as CodeMirror keymaps instead.
   */
  global?: boolean;
  /** Hide from the command palette. */
  hidden?: boolean;
  /** Only available when this returns true. */
  when?: () => boolean;
  /** Extra search keywords for the palette. */
  keywords?: string[];
  run: (...args: any[]) => unknown;
}

interface CommandsState {
  commands: Record<string, Command>;
}

export const useCommands = create<CommandsState>(() => ({ commands: {} }));

export function registerCommand(cmd: Command): Disposable {
  useCommands.setState((s) => ({ commands: { ...s.commands, [cmd.id]: cmd } }));
  return {
    dispose() {
      useCommands.setState((s) => {
        if (s.commands[cmd.id] !== cmd) return s;
        const next = { ...s.commands };
        delete next[cmd.id];
        return { commands: next };
      });
    },
  };
}

export function registerCommands(cmds: Command[]): Disposable {
  const ds = cmds.map(registerCommand);
  return { dispose: () => ds.forEach((d) => d.dispose()) };
}

export async function executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
  const cmd = useCommands.getState().commands[id];
  if (!cmd) {
    console.warn(`[texit] unknown command: ${id}`);
    return undefined;
  }
  if (cmd.when && !cmd.when()) return undefined;
  return cmd.run(...args);
}

export function getCommand(id: string): Command | undefined {
  return useCommands.getState().commands[id];
}

/** Install the global keybinding listener. Call once. */
export function installGlobalKeybindings(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented && !e.metaKey && !e.ctrlKey) return;
    // Let plain form fields (chat composers, comment boxes…) keep Enter-based shortcuts.
    const t = e.target as HTMLElement | null;
    if (e.key === 'Enter' && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const cmds = Object.values(useCommands.getState().commands);
    for (const cmd of cmds) {
      if (!cmd.global || !cmd.keybinding) continue;
      for (const kb of cmd.keybinding.split(/\s*\|\s*/)) {
        if (matchesKeybinding(e, kb)) {
          if (cmd.when && !cmd.when()) continue;
          e.preventDefault();
          e.stopPropagation();
          void cmd.run();
          return;
        }
      }
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
