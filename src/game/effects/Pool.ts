/**
 * Minimal object pool. Objects are created on demand, handed out with get(), and returned with
 * release(); nothing is destroyed during play, so effects never allocate per frame.
 */
export class Pool<T> {
  private free: T[] = [];
  private used = new Set<T>();

  constructor(
    private create: () => T,
    private onGet: (item: T) => void = () => undefined,
    private onRelease: (item: T) => void = () => undefined,
    private max = 256,
  ) {}

  get(): T | null {
    let item = this.free.pop();
    if (!item) {
      if (this.used.size >= this.max) return null;
      item = this.create();
    }
    this.used.add(item);
    this.onGet(item);
    return item;
  }

  release(item: T): void {
    if (!this.used.delete(item)) return;
    this.onRelease(item);
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of [...this.used]) this.release(item);
  }

  get active(): number {
    return this.used.size;
  }

  get size(): number {
    return this.used.size + this.free.length;
  }

  prewarm(n: number): void {
    const tmp: T[] = [];
    for (let i = 0; i < n; i++) {
      const it = this.get();
      if (it) tmp.push(it);
    }
    for (const it of tmp) this.release(it);
  }
}
