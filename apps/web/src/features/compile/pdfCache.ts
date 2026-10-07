/**
 * Persists the last successful compile result per project (PDF + SyncTeX + log)
 * so reopening a project or reloading the page shows the PDF instantly.
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { CompileResult } from '@texit/compiler';

const store = typeof indexedDB !== 'undefined' ? createStore('texit-pdf-cache', 'results') : undefined;

export async function loadCachedResult(projectId: string): Promise<CompileResult | null> {
  if (!store) return null;
  try {
    const r = (await get(projectId, store)) as CompileResult | undefined;
    return r?.pdf ? r : null;
  } catch {
    return null;
  }
}

export async function saveCachedResult(projectId: string, result: CompileResult): Promise<void> {
  if (!store || result.status !== 'success' || !result.pdf) return;
  try {
    // Store a plain, structured-clone-safe copy (log trimmed to keep the cache small).
    const { status, pdf, synctex, log, diagnostics, durationMs, backendId, engine, buildDir } = result;
    await set(projectId, { status, pdf, synctex, log: log.length > 200_000 ? log.slice(-200_000) : log, diagnostics, durationMs, backendId, engine, buildDir }, store);
  } catch (err) {
    console.warn('[compile] could not cache PDF', err);
  }
}

export async function deleteCachedResult(projectId: string): Promise<void> {
  if (store) await del(projectId, store).catch(() => {});
}
