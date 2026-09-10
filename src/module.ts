import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { PackageShape, PackageJson, LinkType } from "./types";
import { Dependency, parseDependency } from "./dependency";
import { collectModuleContent, deriveShape, ModuleContent } from "./content";
import { ConditionalParser } from "./conditional";
import { Toolchain, UserBuildOptions } from "./toolchain";
import type { Target } from "./target";
import { DIRS } from "./constants";
import { ShardError } from "./errors";

export class Module {
  readonly path: string;
  readonly name: string;
  parent: Module | null = null;
  children: Module[] = [];
  deps: Dependency[] = [];
  manifest: PackageJson = {};
  content: ModuleContent = { sourceUnits: [], headerUnits: [], artifactUnits: [] };
  libFlags: string[] = [];
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
    return deriveShape(this.content, this.name);
  }

  load(tc?: Toolchain, defines?: string[]): void {
    if (tc) this.tc = tc;
    const manifestPath = join(this.path, "shard.json");
    const raw = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};
    this.manifest = ConditionalParser.compute(this.tc ?? tc, raw, defines ?? []) as PackageJson;
    this.deps = (this.manifest.depend ?? []).map(parseDependency);
    this.content = collectModuleContent(this.path, this.manifest);
  }

  refreshContent(): void {
    this.content = collectModuleContent(this.path, this.manifest);
  }

  extract(): Target {
    const tc = this.toolchain();
    const includeDirs: string[] = [];
    const add = (d: string): void => { if (!includeDirs.includes(d)) includeDirs.push(d); };

    for (const u of this.content.sourceUnits) add(dirname(u.path));

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

  private toolchain(): Toolchain {
    if (!this.tc) throw new ShardError("toolchain", `Toolchain not available for "${this.name}"`);
    return this.tc;
  }

  get outDir(): string {
    const base = this.isRoot ? this.path : join(this.root.path, DIRS.SHARD, this.name);
    return join(base, DIRS.TARGET, this.targetSubdir());
  }

  private targetSubdir(): string {
    const variant = typeof this.manifest.target === "string" ? this.manifest.target : undefined;
    return variant ? join(this.toolchain().targetDir, variant) : this.toolchain().targetDir;
  }
}
