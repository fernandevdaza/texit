/**
 * Minimal implementation of pdf.js' `IPDFLinkService` for our custom viewer:
 * internal links (\ref, \cite, TOC entries) navigate within the document,
 * external links open in a new tab (or the system browser on desktop).
 */
import { host } from '@/lib/platform';

export interface LinkHandler {
  goToDestination(dest: string | unknown[]): void;
  goToPage(pageNumber: number): void;
  executeNamedAction(action: string): void;
  readonly pagesCount: number;
  readonly page: number;
}

const SAFE_URL = /^(https?|mailto|ftp|tel):/i;

export function openExternalUrl(url: string) {
  if (!SAFE_URL.test(url)) return;
  if (host) void host.shell.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

const noopBus = { dispatch() {}, on() {}, off() {}, _on() {}, _off() {} };

export function createLinkService(h: LinkHandler) {
  return {
    externalLinkEnabled: true,
    eventBus: noopBus,
    isInPresentationMode: false,
    rotation: 0,
    get pagesCount() {
      return h.pagesCount;
    },
    get page() {
      return h.page;
    },
    set page(n: number) {
      h.goToPage(n);
    },
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.title = url;
      link.onclick = (e) => {
        e.preventDefault();
        openExternalUrl(url);
        return false;
      };
    },
    getDestinationHash(dest: unknown) {
      return typeof dest === 'string' && dest ? `#${encodeURIComponent(dest)}` : '#';
    },
    getAnchorUrl(anchor: string) {
      return `#${anchor}`;
    },
    goToDestination(dest: string | unknown[]) {
      h.goToDestination(dest);
      return Promise.resolve();
    },
    goToPage(val: number | string) {
      const n = typeof val === 'string' ? parseInt(val, 10) : val;
      if (Number.isFinite(n)) h.goToPage(n);
    },
    goToXY() {},
    executeNamedAction(action: string) {
      h.executeNamedAction(action);
    },
    executeSetOCGState() {
      return Promise.resolve();
    },
    getAttachmentContent() {
      return Promise.resolve(null);
    },
    setHash() {},
    setDocument() {},
    setViewer() {},
    setHistory() {},
  };
}
