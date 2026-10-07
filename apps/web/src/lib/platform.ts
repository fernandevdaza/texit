import { getHost } from '@texit/core';

export const host = getHost();
export const isDesktop = !!host;
export const isMac =
  host?.platform === 'darwin' ||
  (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
export const isWindows = host?.platform === 'win32' || (typeof navigator !== 'undefined' && /Win/.test(navigator.platform));

/** Render a CodeMirror-style key binding ("Mod-Shift-p") for display: ⌘⇧P / Ctrl+Shift+P. */
export function formatKeybinding(binding: string): string[] {
  return binding.split(/-(?!$)/).map((k) => {
    const key = k.toLowerCase();
    if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
    if (key === 'ctrl') return isMac ? '⌃' : 'Ctrl';
    if (key === 'shift') return isMac ? '⇧' : 'Shift';
    if (key === 'alt') return isMac ? '⌥' : 'Alt';
    if (key === 'meta' || key === 'cmd') return isMac ? '⌘' : 'Win';
    if (key === 'enter') return isMac ? '↩' : 'Enter';
    if (key === 'backspace') return '⌫';
    if (key === 'escape') return 'Esc';
    if (key === 'arrowup') return '↑';
    if (key === 'arrowdown') return '↓';
    if (key === 'arrowleft') return '←';
    if (key === 'arrowright') return '→';
    if (key === 'space') return 'Space';
    return k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
  });
}

/** Whether a keyboard event matches a CodeMirror-style binding like "Mod-Shift-p" or "Mod-Enter". */
export function matchesKeybinding(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.split(/-(?!$)/);
  const key = parts.pop()!.toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const wantMeta = mods.has('meta') || mods.has('cmd') || (mods.has('mod') && isMac);
  const wantCtrl = mods.has('ctrl') || (mods.has('mod') && !isMac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false;
  if (e.altKey !== mods.has('alt')) return false;
  const evKey = e.key.toLowerCase();
  // Shift changes e.key for symbols; only enforce shift for letters / named keys.
  if (mods.has('shift') !== e.shiftKey && (evKey.length > 1 || /[a-z]/.test(evKey))) return false;
  if (evKey === key) return true;
  // Layout-independent fallback via e.code (e.g. "KeyP", "Digit1", "Backslash").
  if (key.length === 1 && /[a-z]/.test(key) && e.code === `Key${key.toUpperCase()}`) return true;
  if (key.length === 1 && /[0-9]/.test(key) && e.code === `Digit${key}`) return true;
  return false;
}
