/** Decoded image residency. Active-round assets are pinned until the next round. */
export class ImageCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private pinned = new Set<string>();
  readonly maxEntries: number;
  readonly maxBytes: number;
  constructor(maxEntries = 12, maxBytes = 64 * 1024 * 1024) { this.maxEntries = maxEntries; this.maxBytes = maxBytes; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes = 0) { this.entries.delete(key); this.entries.set(key, { value, bytes }); this.trim(); }
  retain(keys: Iterable<string>) { this.pinned = new Set(keys); this.trim(); }
  cost(key: string, bytes: number) { const entry = this.entries.get(key); if (entry) entry.bytes = bytes; this.trim(); }
  snapshot() { return { entries:this.entries.size, bytes:[...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0) }; }
  private trim() {
    for (const [key] of this.entries) {
      const size = this.snapshot();
      if (size.entries <= this.maxEntries && size.bytes <= this.maxBytes) break;
      if (!this.pinned.has(key)) this.entries.delete(key);
    }
  }
}
