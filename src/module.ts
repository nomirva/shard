import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { PackageShape, PackageJson, LinkType } from "./types";
import { Dependency } from "./dependency";
import { collectModuleContent, deriveShape, ModuleContent } from "./content";
import { ConditionalParser } from "./conditional";
import { Toolchain, UserBuildOptions } from "./toolchain";
import type { Target } from "./target";
import { DIRS } from "./constants";

export class Module {
  readonly path: string;
  readonly name: string;
  parent: Module | null = null;
  children: Module[] = [];
  deps: Dependency[] = [];
  manifest: PackageJson = {};
  content: ModuleContent = { sourceUnits: [], headerUnits: [], artifactUnits: [] };
  libFlags: string[] = [];
  frameworks: string[] = [];
  requested: LinkType | null = null;
  tc: Toolchain | null = null;

  constructor(path: string, name?: string) {
    this.path = path;
    this.name = name ?? path.split("/").filter(Boolean).pop() ?? "module";
  }

  get root(): Module {
    return this.parent ? this.parent.root : this;
  }

  get isRoot(): boolean {
    return this.parent === null;
  }

  get shape(): PackageShape {
    return deriveShape(this.content);
  }

  load(tc?: Toolchain, defines?: string[]): void {
    if (tc) this.tc = tc;
    const manifestPath = join(this.path, "shard.json");
    const raw = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};
    this.manifest = ConditionalParser.compute(this.tc ?? tc, raw, defines ?? []) as PackageJson;
    this.deps = (this.manifest.depend ?? []).map(d => Dependency.parse(d));
    this.content = collectModuleContent(this.path, this.manifest);
  }

  extract(): Target {
    const tc = this.tc;
    if (!tc) throw new Error(`Toolchain not available for "${this.name}"`);
    const includeDirs: string[] = [];
    const add = (d: string): void => { if (!includeDirs.includes(d)) includeDirs.push(d); };

    for (const u of this.content.sourceUnits) add(dirname(u.path));
    for (const u of this.content.headerUnits) add(dirname(u.path));

    const incl = this.manifest.imports;
    if (incl) {
      const items = Array.isArray(incl) ? incl : Object.keys(incl);
      for (const p of items) {
        const abs = join(this.path, p);
        if (existsSync(abs)) add(abs);
      }
    }

    return {
      name: this.name,
      modulePath: this.path,
      outDir: this.outDir,
      type: this.shape,
      sourceUnits: this.content.sourceUnits,
      headerUnits: this.content.headerUnits,
      includeDirs,
      options: (this.manifest.options ?? {}) as UserBuildOptions,
      requested: this.requested,
    };
  }

  get outDir(): string {
    const tc = this.tc;
    if (!tc) throw new Error(`Toolchain not available for "${this.name}"`);
    const base = this.isRoot ? this.path : join(this.root.path, DIRS.SHARD, this.name);
    return join(base, DIRS.TARGET, this.targetSubdir(tc));
  }

  private targetSubdir(tc: Toolchain): string {
    const variant = typeof this.manifest.target === "string" ? this.manifest.target : undefined;
    const td = tc.targetDir;
    return variant ? join(td, variant) : td;
  }
}
