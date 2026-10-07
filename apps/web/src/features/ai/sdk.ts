/**
 * Lazy loader for @texit/ai (~1.4 MB). Nothing in the main bundle may import
 * `@texit/ai` statically — use `loadAi()` (type-only imports are fine).
 */
import type * as AiSdk from '@texit/ai';

export type AiSdkModule = typeof AiSdk;

let promise: Promise<AiSdkModule> | null = null;
let loaded: AiSdkModule | null = null;

export function loadAi(): Promise<AiSdkModule> {
  if (!promise) {
    promise = import('@texit/ai').then((m) => (loaded = m));
    promise.catch(() => (promise = null));
  }
  return promise;
}

/** The SDK if it has already been loaded (sync access for hot paths). */
export function aiIfLoaded(): AiSdkModule | null {
  return loaded;
}
