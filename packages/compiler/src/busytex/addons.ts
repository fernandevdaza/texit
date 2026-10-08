/**
 * TeX Live add-ons: runtime files that the BusyTeX data packages don't ship
 * (babel language definitions such as `spanish.ldf`, IEEEtran, font packages
 * such as newtx…). They are served next to the app (`texlive-addons/`) and
 * injected into the compile directory only when a project needs them and
 * doesn't provide them itself.
 *
 * `manifest.json`:
 *   files    basename → path, for single files. Requesting one also brings the
 *            other files of the same folder (e.g. `ngerman.ldf` + `babel-german.def`).
 *   bundles  font packages and other large sets, shipped as one zip:
 *            { triggers, archive, requires, pdfMapFiles }. A trigger (e.g.
 *            `newtxtext.sty`) injects the whole bundle; `requires` are TeX Live
 *            files the bundle needs (they raise the data-package tier);
 *            `pdfMapFiles` must be activated for pdfTeX with \pdfmapfile.
 */
import { unzipSync } from 'fflate';
import { basename, dirname } from '@texit/core';

export interface AddonBundle {
  description?: string;
  triggers: string[];
  archive: string;
  requires?: string[];
  pdfMapFiles?: string[];
}

export interface AddonManifest {
  version: number;
  files: Record<string, string>;
  bundles?: Record<string, AddonBundle>;
}

export interface AddonFile {
  name: string;
  content: Uint8Array;
}

export interface AddonPlan {
  /** Single files (basenames) to inject. */
  files: string[];
  /** Bundle ids to inject. */
  bundles: string[];
  /** TeX Live files the planned add-ons need (for data-package selection). */
  requires: string[];
  /** Font map files to activate with \pdfmapfile (pdfTeX). */
  pdfMapFiles: string[];
  /** Requirements satisfied by this plan. */
  satisfied: string[];
}

export const EMPTY_PLAN: AddonPlan = { files: [], bundles: [], requires: [], pdfMapFiles: [], satisfied: [] };

export class TexAddons {
  private manifestPromise: Promise<AddonManifest | null> | null = null;
  private readonly fileCache = new Map<string, Promise<Uint8Array | null>>();
  private readonly bundleCache = new Map<string, Promise<AddonFile[]>>();

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

  /** Decide which add-ons satisfy `wanted` (requirement names; `a|b` alternatives allowed). */
  async plan(wanted: Iterable<string>, provided: ReadonlySet<string>): Promise<AddonPlan> {
    const m = await this.manifest();
    if (!m) return EMPTY_PLAN;
    const dirs = new Set<string>();
    const bundles = new Set<string>();
    const satisfied: string[] = [];
    for (const req of wanted) {
      const alts = req.split('|');
      if (alts.some((a) => provided.has(a))) continue;
      const bundle = Object.entries(m.bundles ?? {}).find(([, b]) => alts.some((a) => b.triggers.includes(a)));
      if (bundle) {
        bundles.add(bundle[0]);
        satisfied.push(req);
        continue;
      }
      const hit = alts.find((a) => m.files[a]);
      if (hit) {
        dirs.add(dirname(m.files[hit]));
        satisfied.push(req);
      }
    }
    const files = Object.entries(m.files)
      .filter(([name, rel]) => dirs.has(dirname(rel)) && !provided.has(name))
      .map(([name]) => name);
    const ids = [...bundles];
    return {
      files,
      bundles: ids,
      requires: [...new Set(ids.flatMap((id) => m.bundles![id].requires ?? []))],
      pdfMapFiles: [...new Set(ids.flatMap((id) => m.bundles![id].pdfMapFiles ?? []))],
      satisfied,
    };
  }

  /** @deprecated use `plan` — kept for callers that only need single files. */
  async resolve(wanted: Iterable<string>, provided: ReadonlySet<string>): Promise<string[]> {
    const p = await this.plan(wanted, provided);
    return p.files;
  }

  /** Fetch the planned files (single files + unpacked bundles), skipping names the project provides. */
  async loadPlan(plan: AddonPlan, provided: ReadonlySet<string> = new Set()): Promise<AddonFile[]> {
    const [single, ...bundles] = await Promise.all([this.load(plan.files), ...plan.bundles.map((id) => this.loadBundle(id))]);
    const out = new Map<string, AddonFile>();
    for (const f of [...single, ...bundles.flat()]) if (!provided.has(f.name)) out.set(f.name, f);
    return [...out.values()];
  }

  async load(names: string[]): Promise<AddonFile[]> {
    const m = await this.manifest();
    if (!m || !this.baseUrl) return [];
    const out = await Promise.all(
      names.map(async (name) => {
        const rel = m.files[name];
        if (!rel) return null;
        let p = this.fileCache.get(name);
        if (!p) {
          p = this.fetchBytes(rel).catch(() => {
            this.fileCache.delete(name);
            return null;
          });
          this.fileCache.set(name, p);
        }
        const content = await p;
        return content ? { name, content } : null;
      }),
    );
    return out.filter((f): f is AddonFile => !!f);
  }

  private loadBundle(id: string): Promise<AddonFile[]> {
    let p = this.bundleCache.get(id);
    if (!p) {
      p = (async () => {
        const m = await this.manifest();
        const b = m?.bundles?.[id];
        if (!b) return [];
        const zip = unzipSync(await this.fetchBytes(b.archive));
        return Object.entries(zip)
          .filter(([path]) => !path.endsWith('/'))
          .map(([path, content]) => ({ name: basename(path), content }));
      })().catch((err) => {
        this.bundleCache.delete(id);
        console.warn(`[texit] could not load TeX add-on bundle "${id}"`, err);
        return [];
      });
      this.bundleCache.set(id, p);
    }
    return p;
  }

  private async fetchBytes(rel: string): Promise<Uint8Array> {
    const r = await this.fetchFn(new URL(rel, this.baseUrl!).href);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

/** Basenames of every file the project provides (so add-ons never shadow user files). */
export function providedNames(paths: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const p of paths) s.add(basename(p));
  return s;
}

/**
 * Activate font map files for pdfTeX by prefixing line 1 of the (compiled copy
 * of the) main file — no line shift, so diagnostics and SyncTeX stay aligned.
 * Guarded with \ifdefined so XeTeX/LuaTeX ignore it.
 */
export function withPdfMapFiles(source: string, mapFiles: string[]): string {
  if (!mapFiles.length) return source;
  const prefix = mapFiles.map((f) => `\\ifdefined\\pdfmapfile\\pdfmapfile{=${f}}\\fi`).join('');
  return prefix + source;
}
