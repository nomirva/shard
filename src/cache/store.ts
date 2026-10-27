import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface CacheStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  flush(): void;
}

/** `<root>/.shard/cache.json`: a flat key → fingerprint dictionary. */
export class JsonCacheStore implements CacheStore {
  private entries: Record<string, string> = {};
  private dirty = false;
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "cache.json");
    try {
      this.entries = JSON.parse(readFileSync(this.file, "utf-8"));
    } catch {
      this.entries = {};
    }
  }

  get(key: string): string | undefined {
    return this.entries[key];
  }

  set(key: string, value: string): void {
    this.entries[key] = value;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
    this.dirty = false;
  }
}
