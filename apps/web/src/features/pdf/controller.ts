/**
 * Registry of live PDF preview viewers (the docked pane and an optional
 * detached window) so commands can act on them, plus pane UI state shared
 * between the pane, its detached window and the commands.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PdfPosition, PdfView, Zoom } from './engine';

const views = new Map<string, PdfView>();
let lastFocused: string | null = null;

export function registerPreviewView(id: string, view: PdfView | null) {
  if (view) {
    views.set(id, view);
    view.element?.addEventListener('focusin', () => (lastFocused = id));
  } else {
    views.delete(id);
    if (lastFocused === id) lastFocused = null;
  }
  usePdfPane.setState({ viewCount: views.size });
}

/** The viewer commands should act on: the last focused one, else the docked pane. */
export function activePreviewView(): PdfView | null {
  return (lastFocused && views.get(lastFocused)) || views.get('pane') || views.values().next().value || null;
}

export function allPreviewViews(): PdfView[] {
  return [...views.values()];
}

interface PaneState {
  thumbnails: boolean;
  /** Error banner dismissed for this compile result. */
  dismissedResult: unknown;
  popoutOpen: boolean;
  viewCount: number;
  /** Remembered across pane remounts (toggling the pane, switching layouts). */
  zoom: Zoom | null;
  position: PdfPosition | null;
}

export const usePdfPane = create<PaneState>()(
  persist(
    () => ({ thumbnails: false, dismissedResult: null, popoutOpen: false, viewCount: 0, zoom: null, position: null }) as PaneState,
    { name: 'texit:pdf-pane', version: 1, partialize: (s) => ({ thumbnails: s.thumbnails, zoom: s.zoom }) as PaneState },
  ),
);
