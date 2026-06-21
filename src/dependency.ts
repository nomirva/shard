import { readdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { LinkType } from "./types";
import { Fetcher } from "./fetcher";
import type { Module } from "./module";

export class Dependency {
  module: Module | null = null;

  constructor(
    readonly raw: string,
    readonly prefix: string,
    readonly value: string,
    readonly linkType?: LinkType,
    readonly version?: string
  ) {}

  get isSystem(): boolean { return this.prefix === "sys" || this.prefix === "framework"; }
  get isRemote(): boolean { return this.prefix === "git"; }
  get isLocal(): boolean { return this.prefix === "path"; }

  get libFlag(): string | null {
    if (this.prefix === "sys") return `-l${this.value}`;
    if (this.prefix === "framework") return `-Wl,-framework,${this.value}`;
    return null;
  }

  get label(): string {
    const parts = [this.linkType ?? `default (${LinkType.Static})`, this.version].filter(Boolean);
    return parts.join(", ");
  }

  install(rootDir: string, parentPath: string): string {
    if (this.isRemote) return Fetcher.git(this.value, rootDir, this.version);
    if (this.isLocal) return Fetcher.local(resolve(parentPath, this.value), rootDir);
    throw new Error(`Cannot install system dependency: ${this.raw}`);
  }

  static clean(rootDir: string, activePaths: Set<string>): void {
    const modulesDir = join(rootDir, "modules");
    if (!existsSync(modulesDir)) return;
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(modulesDir, entry.name);
      if (!activePaths.has(fullPath)) {
        rmSync(fullPath, { recursive: true, force: true });
        process.stderr.write(`  removed: ${entry.name}\n`);
      }
    }
  }
}
