/** Minimal LRU map (Map preserves insertion order; re-insert on access). */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private capacity: number) {
    if (capacity < 1) throw new Error('LruCache capacity must be >= 1');
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as K);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  resize(capacity: number): void {
    if (capacity < 1) throw new Error('LruCache capacity must be >= 1');
    this.capacity = capacity;
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as K);
  }
}
