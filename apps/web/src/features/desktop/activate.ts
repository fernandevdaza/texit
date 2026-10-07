/**
 * Desktop feature activation: routes native menu commands to the command
 * registry and keeps the Windows/Linux window-controls overlay in sync with the
 * app theme. No-op in the browser.
 */
import { getHost } from '@texit/core';
import { executeCommand, getCommand } from '@/services/commands';

export function activate(): () => void {
  const host = getHost();
  if (!host) return () => undefined;
  const disposers: (() => void)[] = [];

  disposers.push(host.app.onMenuCommand((id) => void executeCommand(id)));

  // Files opened from the OS are surfaced as a DOM event (and a command, if one is registered).
  disposers.push(
    host.app.onOpenPath((absPath) => {
      window.dispatchEvent(new CustomEvent('texit:open-path', { detail: { path: absPath } }));
      if (getCommand('project.openPath')) void executeCommand('project.openPath', absPath);
    }),
  );
  if (host.app.onDeepLink) {
    disposers.push(host.app.onDeepLink((url) => window.dispatchEvent(new CustomEvent('texit:deep-link', { detail: { url } }))));
  }

  if (host.app.setTitleBarOverlay && host.platform !== 'darwin') {
    let last = '';
    const sync = () => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const fg = getComputedStyle(document.body).color;
      const key = `${bg}|${fg}`;
      if (!bg || key === last || bg === 'rgba(0, 0, 0, 0)') return;
      last = key;
      void host.app.setTitleBarOverlay!({ color: bg, symbolColor: fg }).catch(() => undefined);
    };
    const observer = new MutationObserver(() => requestAnimationFrame(sync));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    requestAnimationFrame(sync);
    disposers.push(() => observer.disconnect());
  }

  return () => disposers.splice(0).forEach((d) => d());
}
