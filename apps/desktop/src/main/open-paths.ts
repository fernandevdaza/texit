/**
 * Files/folders and deep links handed to TexIt by the OS: double-clicked .tex
 * files, `texit://` links, paths on the command line, second-instance launches.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEEP_LINK_SCHEME = 'texit';

export interface ArgvOptions {
  cwd: string;
  isPackaged: boolean;
  exists?: (p: string) => boolean;
}

/**
 * Extract existing file/folder paths from a process argv.
 * argv[0] is the executable; in dev (`electron dist-electron/main.cjs …`) argv[1] is the entry script.
 */
export function extractOpenPaths(argv: string[], opts: ArgvOptions): string[] {
  const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
  const args = argv.slice(opts.isPackaged ? 1 : 2);
  const out: string[] = [];
  let afterDashDash = false;
  for (const a of args) {
    if (!a) continue;
    if (!afterDashDash && a === '--') {
      afterDashDash = true;
      continue;
    }
    if (!afterDashDash && a.startsWith('-')) continue; // switches (--smoke, --inspect, Chromium flags…)
    if (a.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) continue; // other URLs
    const abs = path.resolve(opts.cwd, a);
    if (/[\\/]dist-electron[\\/]main\.cjs$/.test(abs)) continue;
    if (exists(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** `texit://…` deep links present in argv (Windows/Linux deliver them this way). */
export function extractDeepLinks(argv: string[]): string[] {
  return argv.filter((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`));
}

/**
 * Queue that holds OS-provided paths until a renderer subscribes, then delivers
 * them in order.
 */
export class PendingQueue<T> {
  private items: T[] = [];
  private sink: ((item: T) => boolean) | null = null;

  push(item: T): void {
    if (this.sink && this.sink(item)) return;
    this.items.push(item);
  }

  /** Attach a delivery function; returns undelivered items to the queue if it fails. */
  attach(sink: (item: T) => boolean): void {
    this.sink = sink;
    const pending = this.items;
    this.items = [];
    for (const it of pending) if (!sink(it)) this.items.push(it);
  }

  detach(): void {
    this.sink = null;
  }

  get size(): number {
    return this.items.length;
  }
}
