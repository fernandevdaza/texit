/**
 * TeX Live add-ons: runtime files that the BusyTeX data packages don't ship
 * (babel language definitions such as `spanish.ldf`, IEEEtran…). They are
 * served next to the app (`texlive-addons/manifest.json`) and injected into
 * the compile directory only when a project needs them and doesn't provide
 * them itself.
 */
import { basename, dirname } from '@texit/core';

export interface AddonManifest {
  version: number;
  /** basename → path relative to the add-ons directory. */
  files: Record<string, string>;
}

export interface AddonFile {
  name: string;
  content: Uint8Array;
}

export class TexAddons {
  private manifestPromise: Promise<AddonManifest | null> | null = null;
  private readonly cache = new Map<string, Promise<Uint8Array | null>>();

  constructor(
    private readonly baseUrl: string | null,
    private readonly fetchFn: typeof fetch,
  ) {}

  manifest(): Promise<AddonManifest | null> {
    if (!this.baseUrl) return Promise.resolve(null);
    this.manifestPromise ??= this.fetchFn(new URL('manifest.json', this.baseUrl).href)
      .then((r) => (r.ok ? (r.json() as Promise<AddonManifest>) : null))
      .then((m) => (m && typeof m.files === 'object' ? m : null))
      .catch(() => null);
    return this.manifestPromise;
  }

  /**
   * Which add-on files satisfy `wanted` (requirement names, `a|b` alternatives
   * allowed). Files that live in the same add-on folder are included too
   * (e.g. `ngerman.ldf` also brings `babel-german.def`), so companions resolve.
   */
  async resolve(wanted: Iterable<string>, provided: ReadonlySet<string>): Promise<string[]> {
    const m = await this.manifest();
    if (!m) return [];
    const dirs = new Set<string>();
    for (const req of wanted) {
      const hit = req.split('|').find((alt) => m.files[alt] && !provided.has(alt));
      if (hit) dirs.add(dirname(m.files[hit]));
    }
    if (!dirs.size) return [];
    return Object.entries(m.files)
      .filter(([name, rel]) => dirs.has(dirname(rel)) && !provided.has(name))
      .map(([name]) => name);
  }

  async load(names: string[]): Promise<AddonFile[]> {
    const m = await this.manifest();
    if (!m || !this.baseUrl) return [];
    const out = await Promise.all(
      names.map(async (name) => {
        const rel = m.files[name];
        if (!rel) return null;
        let p = this.cache.get(name);
        if (!p) {
          p = this.fetchFn(new URL(rel, this.baseUrl!).href)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((b) => new Uint8Array(b))
            .catch(() => {
              this.cache.delete(name);
              return null;
            });
          this.cache.set(name, p);
        }
        const content = await p;
        return content ? { name, content } : null;
      }),
    );
    return out.filter((f): f is AddonFile => !!f);
  }
}

/** Basenames of every file the project provides (so add-ons never shadow user files). */
export function providedNames(paths: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const p of paths) s.add(basename(p));
  return s;
}
