import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CompileTask, Toolchain } from "../toolchain/toolchain";

export class Cache {
  private entries: Record<string, string> = {};
  private dirty = false;
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "cache.json");
    this.load();
  }

  isFresh(moduleId: string, task: CompileTask, tc: Toolchain): boolean {
    return this.entries[`${moduleId}/${task.relPath}`] === this.hash(task, tc);
  }

  record(moduleId: string, task: CompileTask, tc: Toolchain): void {
    this.entries[`${moduleId}/${task.relPath}`] = this.hash(task, tc);
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
    this.dirty = false;
  }

  private hash(task: CompileTask, tc: Toolchain): string {
    const hash = createHash("sha256");
    hash.update(readFileSync(task.source.path));
    hash.update(JSON.stringify(task.options));
    for (const dep of tc.dependencies(task)) {
      if (existsSync(dep)) hash.update(readFileSync(dep));
    }
    return hash.digest("hex");
  }

  private load(): void {
    try {
      this.entries = JSON.parse(readFileSync(this.file, "utf-8"));
    } catch {
      this.entries = {};
    }
  }
}
