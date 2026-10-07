/**
 * Persist and restore window bounds / maximized / fullscreen state.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow, Rectangle } from 'electron';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
  fullscreen?: boolean;
}

export const DEFAULT_STATE: WindowState = { width: 1440, height: 900 };
const MIN_W = 720;
const MIN_H = 480;

/**
 * Ensure the saved bounds are still visible on one of the current displays
 * (monitors may have been unplugged since the last run).
 */
export function fitToDisplays(state: WindowState, workAreas: Rectangle[]): WindowState {
  const width = Math.max(MIN_W, Math.round(state.width || DEFAULT_STATE.width));
  const height = Math.max(MIN_H, Math.round(state.height || DEFAULT_STATE.height));
  const out: WindowState = { width, height, maximized: !!state.maximized, fullscreen: !!state.fullscreen };
  if (typeof state.x !== 'number' || typeof state.y !== 'number' || !workAreas.length) return out;
  const visible = workAreas.find((a) => {
    const ix = Math.max(0, Math.min(state.x! + width, a.x + a.width) - Math.max(state.x!, a.x));
    const iy = Math.max(0, Math.min(state.y! + height, a.y + a.height) - Math.max(state.y!, a.y));
    return ix >= 120 && iy >= 80; // a grabbable chunk of the window is on this display
  });
  if (!visible) return out;
  out.x = Math.round(state.x);
  out.y = Math.round(state.y);
  out.width = Math.min(width, visible.width);
  out.height = Math.min(height, visible.height);
  return out;
}

export function loadWindowState(file: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw.width === 'number' && typeof raw.height === 'number') return raw as WindowState;
  } catch {
    /* first run */
  }
  return { ...DEFAULT_STATE };
}

/** Track a window and save its state (debounced) on move / resize / close. */
export function trackWindowState(win: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const fullscreen = win.isFullScreen();
    const bounds = maximized || fullscreen ? win.getNormalBounds() : win.getBounds();
    const state: WindowState = { ...bounds, maximized, fullscreen };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(ev as any, schedule);
  }
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
