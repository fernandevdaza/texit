import { deferred, type Deferred } from './util';

interface KeyState<Req, Res> {
  pending?: { req: Req; waiters: Deferred<Res>[] };
}

/**
 * Per-key "run now, then once more with the latest request" queue.
 *
 * - If nothing runs for `key`, the request starts immediately.
 * - While a run is in progress, new requests are coalesced into a single
 *   pending run that uses the *latest* request; intermediate requests are
 *   dropped and their callers receive the result of that pending run.
 */
export class CoalescingQueue<Req, Res> {
  private readonly states = new Map<string, KeyState<Req, Res>>();

  constructor(private readonly runner: (key: string, req: Req) => Promise<Res>) {}

  submit(key: string, req: Req): Promise<Res> {
    const state = this.states.get(key);
    if (!state) {
      const s: KeyState<Req, Res> = {};
      this.states.set(key, s);
      return this.start(key, s, req);
    }
    const d = deferred<Res>();
    if (state.pending) {
      state.pending.req = req;
      state.pending.waiters.push(d);
    } else {
      state.pending = { req, waiters: [d] };
    }
    return d.promise;
  }

  isRunning(key: string): boolean {
    return this.states.has(key);
  }

  hasPending(key: string): boolean {
    return !!this.states.get(key)?.pending;
  }

  /** Remove the pending (not yet started) run for `key` and settle its callers with `result`. */
  dropPending(key: string, result: Res): boolean {
    const s = this.states.get(key);
    const pending = s?.pending;
    if (!s || !pending) return false;
    s.pending = undefined;
    for (const w of pending.waiters) w.resolve(result);
    return true;
  }

  keys(): string[] {
    return [...this.states.keys()];
  }

  private start(key: string, s: KeyState<Req, Res>, req: Req): Promise<Res> {
    let p: Promise<Res>;
    try {
      p = this.runner(key, req);
    } catch (err) {
      p = Promise.reject(err);
    }
    const next = () => this.next(key, s);
    p.then(next, next);
    return p;
  }

  private next(key: string, s: KeyState<Req, Res>): void {
    const pending = s.pending;
    s.pending = undefined;
    if (!pending) {
      if (this.states.get(key) === s) this.states.delete(key);
      return;
    }
    const p = this.start(key, s, pending.req);
    p.then(
      (r) => pending.waiters.forEach((w) => w.resolve(r)),
      (e) => pending.waiters.forEach((w) => w.reject(e)),
    );
  }
}
