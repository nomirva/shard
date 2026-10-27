import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, sep } from "path";

export interface StoredModule {
  path: string;
  dirName: string;
}

export class ModuleStore {
  constructor(readonly dir: string) {}

  pathFor(dirName: string): string {
    return join(this.dir, dirName);
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  find(name: string): StoredModule | null {
    if (!existsSync(this.dir)) return null;
    const matches = readdirSync(this.dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && (e.name === name || e.name.startsWith(name + "@")))
      .map(e => ({ path: join(this.dir, e.name), dirName: e.name }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return matches[0] ?? null;
  }

  prune(activePaths: readonly string[]): string[] {
    const removed: string[] = [];
    if (!existsSync(this.dir)) return removed;
    const active = new Set(activePaths);
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(this.dir, entry.name);
      const isActive = active.has(full) || activePaths.some(p => p.startsWith(full + sep));
      if (!isActive) {
        rmSync(full, { recursive: true, force: true });
        removed.push(entry.name);
      }
    }
    return removed;
  }
}
