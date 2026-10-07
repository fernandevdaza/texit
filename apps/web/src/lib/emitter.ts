import type { Disposable } from '@texit/core';

/** Tiny typed event emitter. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(cb: (value: T) => void): Disposable {
    this.listeners.add(cb);
    return { dispose: () => this.listeners.delete(cb) };
  }

  emit(value: T) {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(value);
      } catch (err) {
        console.error('[texit] listener error', err);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}

export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (!done) {
        done = true;
        fn();
      }
    },
  };
}
