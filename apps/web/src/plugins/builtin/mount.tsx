/**
 * Built-in plugins render their DOM panels/modals with React. This helper
 * mounts a React tree into the container handed over by `api.ui.registerPanel`
 * / `api.ui.modal` and returns the cleanup function the API expects.
 * (Third-party plugins are free to use plain DOM or any framework.)
 */
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/ui/Tooltip';

export function mountReact(container: HTMLElement, node: ReactNode): () => void {
  // Mount into a child element: the host may clear `container` synchronously on
  // cleanup while React unmounts asynchronously (it can't unmount during a render).
  const host = document.createElement('div');
  host.style.height = '100%';
  container.append(host);
  const root = createRoot(host);
  root.render(<TooltipProvider>{node}</TooltipProvider>);
  return () => {
    setTimeout(() => root.unmount(), 0);
  };
}
