/**
 * A Map that keeps at most `limit` entries in memory, dropping the one used least recently
 * (read with `get` or written with `set`) to make room, so keys a client can make up don't
 * grow it without bound.
 */
export class LruMap<K, V> {
  // A Map keeps insertion order, and each use inserts its key again: the least recently used
  // key comes first.
  readonly #entries = new Map<K, V>();

  constructor(readonly limit: number) {}

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    if (!this.#entries.has(key)) return undefined;
    // SAFETY: `has` just found the key.
    const value = this.#entries.get(key) as V;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    const [oldest] = this.#entries.keys();
    if (this.#entries.size > this.limit && oldest !== undefined) this.#entries.delete(oldest);
  }

  delete(key: K): void {
    this.#entries.delete(key);
  }
}
