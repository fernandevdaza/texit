/**
 * Main window: polished frameless chrome per platform, persisted bounds,
 * theme-aware background and window-controls overlay.
 */
import path from 'node:path';
import { BrowserWindow, nativeTheme, screen, type TitleBarOverlayOptions } from 'electron';
import type { WindowChromeInfo } from '../shared/ipc';
import { fitToDisplays, loadWindowState, trackWindowState } from './window-state';
import { paths } from './paths';

export const TITLE_BAR_HEIGHT = 40;
const TRAFFIC_LIGHTS = { x: 14, y: 14 };

const COLORS = {
  dark: { background: '#0b0b0f', symbol: '#e4e4e7' },
  light: { background: '#fafafa', symbol: '#27272a' },
};

export function windowChrome(platform: NodeJS.Platform = process.platform): WindowChromeInfo {
  if (platform === 'darwin') return { style: 'hiddenInset', height: TITLE_BAR_HEIGHT, insetLeft: 80, insetRight: 0 };
  return { style: 'overlay', height: TITLE_BAR_HEIGHT, insetLeft: 0, insetRight: 140 };
}

function themeColors() {
  return nativeTheme.shouldUseDarkColors ? COLORS.dark : COLORS.light;
}

/** Overlay colors explicitly chosen by the renderer (its theme may differ from the OS theme). */
const customOverlay = new WeakMap<BrowserWindow, TitleBarOverlayOptions>();

export function setTitleBarOverlay(win: BrowserWindow, opts: TitleBarOverlayOptions): void {
  if (process.platform === 'darwin' || win.isDestroyed()) return;
  const merged = { ...customOverlay.get(win), ...opts };
  customOverlay.set(win, merged);
  try {
    win.setTitleBarOverlay({ height: TITLE_BAR_HEIGHT, ...merged });
  } catch {
    /* overlay not enabled (e.g. some Linux WMs) */
  }
  if (opts.color && /^#[0-9a-f]{6}$/i.test(opts.color)) win.setBackgroundColor(opts.color);
}

export interface CreateWindowOptions {
  url: string;
  preload: string;
  show?: boolean;
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const state = fitToDisplays(
    loadWindowState(paths.windowState()),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const colors = themeColors();
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'TexIt',
    backgroundColor: colors.background,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: TRAFFIC_LIGHTS }
      : { titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true,
      navigateOnDragDrop: false,
      autoplayPolicy: 'user-gesture-required',
    },
  });

  trackWindowState(win, paths.windowState());

  const onTheme = () => {
    if (win.isDestroyed()) return;
    const c = themeColors();
    if (!customOverlay.has(win)) {
      win.setBackgroundColor(c.background);
      if (!isMac) {
        try {
          win.setTitleBarOverlay({ color: c.background, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT });
        } catch {
          /* ignore */
        }
      }
    }
  };
  nativeTheme.on('updated', onTheme);
  win.on('closed', () => nativeTheme.off('updated', onTheme));

  if (opts.show !== false) {
    win.once('ready-to-show', () => {
      if (state.maximized) win.maximize();
      win.show();
      if (state.fullscreen) win.setFullScreen(true);
    });
  }

  void win.loadURL(opts.url);
  return win;
}

export function preloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}
