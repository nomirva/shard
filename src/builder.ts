import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Glob } from "bun";
import chalk from "chalk";
import { PackageShape, LinkType } from "./types";
import { CompileTask, CompileOptions, LinkTask, ArchiveTask, Toolchain } from "./toolchain";
import { Module } from "./module";
import { DIRS } from "./constants";

export class Builder {
  private cache: Record<string, string> = {};
  private cacheDir: string;

  constructor(
    private toolchain: Toolchain,
    rootPath: string,
    private extraDefines: string[] = [],
    private ignoreCache: number = 0,
  ) {
    this.cacheDir = join(rootPath, DIRS.SHARD);
    this.loadCache();
  }

  async buildModules(modules: Module[]): Promise<void> {
    for (const module of modules) {
      await this.buildModule(module);
    }
  }

  private async buildModule(module: Module): Promise<void> {
    this.runHook(module, "prebuild");

    if (module.shape === PackageShape.Prebuilt) {
      this.buildPrebuilt(module);
    } else if (module.shape === PackageShape.HeaderOnly) {
      // nothing to compile or link
    } else {
      const obj = await this.compileModule(module);
      this.linkModule(module, obj);
    }

    this.exportHeaders(module);
    this.runHook(module, "postbuild");
  }

  private async compileModule(module: Module): Promise<string[]> {
    const mode = this.ignoreCache;
    const useCache = mode === 0 || (mode === 1 && !module.isRoot);
    const prefix = module.isRoot ? "_" : module.name;
    const objects: string[] = [];

    for (const source of module.content.sourceUnits) {
      const rel = relPath(module.path, source.path).replace(/\.c$/, ".o");
      const object = join(this.cacheDir, prefix, rel);
      const task: CompileTask = {
        source,
        object,
        relPath: rel,
        options: this.compileOptions(module),
      };

      if (useCache && this.isFresh(prefix, task)) {
        process.stderr.write(` ${chalk.dim("≡")} ${module.name}/${rel}\n`);
        objects.push(object);
        continue;
      }

      mkdirSync(dirname(object), { recursive: true });
      try {
        await this.toolchain.compile(task, module.path);
        process.stderr.write(` ${chalk.green("✔")} ${module.name}/${rel}\n`);
      } catch (err) {
        process.stderr.write(` ${chalk.red("✘")} ${module.name}/${rel}\n`);
        throw err;
      }
      if (useCache) this.recordCache(prefix, task);
      objects.push(object);
    }

    if (useCache) this.saveCache();
    return objects;
  }

  private linkModule(module: Module, objects: string[]): void {
    const o = module.manifest.options ?? {};
    const requested = module.requested ?? LinkType.Static;

    if (module.shape === PackageShape.Executable) {
      const output = join(module.outDir, `${module.name}${this.toolchain.exeExt ?? ""}`);
      mkdirSync(dirname(output), { recursive: true });
      this.toolchain.link({
        kind: "executable",
        objects,
        output,
        options: {
          libPaths: this.transitiveLibPaths(module),
          libFlags: [...this.transitiveFlags(module), ...module.libFlags],
          subsystem: o.subsystem,
          extra: o.linkExtra as string[] | undefined,
        },
      });
      for (const sl of this.transitiveShared(module)) {
        copyFileSync(sl, join(dirname(output), sl.split("/").pop()!));
      }
      return;
    }

    this.buildLibrary(module, objects, requested, o.subsystem, o.linkExtra as string[] | undefined);
    if (module.isRoot && module.shape === PackageShape.Library) {
      const other = requested === LinkType.Static ? LinkType.Shared : LinkType.Static;
      this.buildLibrary(module, objects, other, o.subsystem, o.linkExtra as string[] | undefined);
    }
  }

  private buildLibrary(module: Module, objects: string[], linkType: LinkType, subsystem?: string, extra?: string[]): void {
    mkdirSync(module.outDir, { recursive: true });

    if (linkType === LinkType.Static) {
      const output = join(module.outDir, `${module.name}.a`);
      this.toolchain.archive({ objects, output });
      return;
    }

    const sExt = this.toolchain.sharedLibExt;
    if (!sExt) throw new Error(`Shared libraries not supported on target "${this.toolchain.currentTarget.platform}"`);
    const output = join(module.outDir, `${module.name}${sExt}`);
    this.toolchain.link({
      kind: "shared",
      objects,
      output,
      options: {
        libPaths: this.transitiveLibPaths(module),
        libFlags: [...this.transitiveFlags(module), ...module.libFlags],
        subsystem,
        extra,
      },
    });
  }

  private buildPrebuilt(module: Module): void {
    if (!existsSync(module.outDir)) {
      throw new Error(`Invalid prebuilt package "${module.name}": expected libraries at "${module.outDir}"`);
    }
  }

  private compileOptions(module: Module): CompileOptions {
    const o = module.manifest.options ?? {};
    const includePaths = [...this.transitiveIncludeDirs(module)];
    const own = module.extract().includeDirs;
    for (const d of own) {
      if (!includePaths.includes(d)) includePaths.push(d);
    }
    return {
      includePaths,
      optimize: o.optimize ? (`-O${o.optimize}` as const) : undefined,
      debug: o.debug,
      standard: o.standard ? (`-std=${o.standard}` as const) : undefined,
      warnings: o.warnings,
      defines: [...(o.defines as string[] | undefined ?? []), ...this.extraDefines],
      extra: o.compileExtra as string[] | undefined,
    };
  }

  private transitiveIncludeDirs(module: Module): string[] {
    const dirs: string[] = [];
    const walk = (m: Module): void => {
      for (const child of m.children) {
        for (const d of exportDirs(child)) {
          if (!dirs.includes(d)) dirs.push(d);
        }
        walk(child);
      }
    };
    walk(module);
    return dirs;
  }

  private transitiveLibPaths(module: Module): string[] {
    const paths: string[] = [];
    const walk = (m: Module): void => {
      for (const child of m.children) {
        const p = artifactPath(child, this.toolchain);
        if (p && !paths.includes(p)) paths.push(p);
        walk(child);
      }
    };
    walk(module);
    return paths;
  }

  private transitiveFlags(module: Module): string[] {
    const flags: string[] = [];
    const walk = (m: Module): void => {
      for (const child of m.children) {
        flags.push(...child.libFlags);
        walk(child);
      }
    };
    walk(module);
    return flags;
  }

  private transitiveShared(module: Module): string[] {
    const shared: string[] = [];
    const walk = (m: Module): void => {
      for (const child of m.children) {
        const p = sharedArtifactPath(child, this.toolchain);
        if (p && existsSync(p) && !shared.includes(p)) shared.push(p);
        walk(child);
      }
    };
    walk(module);
    return shared;
  }

  private exportHeaders(module: Module): void {
    if (module.content.headerUnits.length === 0) return;
    const destRoot = join(module.outDir, DIRS.INCLUDE);
    const plans = exportDestinations(module);
    for (const { unit, rel } of plans) {
      const dst = join(destRoot, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(unit.path, dst);
    }
  }

  private runHook(module: Module, name: string): void {
    const cmd = module.manifest.scripts?.[name];
    if (!cmd) return;
    const r = spawnSync(cmd, [], { stdio: "inherit", shell: true, cwd: module.path });
    if (r.status !== 0) throw new Error(`"${name}" failed`);
  }

  private key(moduleName: string, relPath: string): string {
    return `${moduleName}/${relPath}`;
  }

  private computeHash(task: CompileTask): string {
    const hash = createHash("sha256");
    hash.update(readFileSync(task.source.path));
    hash.update(JSON.stringify(task.options));
    for (const dep of this.toolchain.dependencies(task)) {
      if (existsSync(dep)) hash.update(readFileSync(dep));
    }
    return hash.digest("hex");
  }

  private isFresh(moduleName: string, task: CompileTask): boolean {
    return this.cache[this.key(moduleName, task.relPath)] === this.computeHash(task);
  }

  private recordCache(moduleName: string, task: CompileTask): void {
    this.cache[this.key(moduleName, task.relPath)] = this.computeHash(task);
  }

  private loadCache(): void {
    try {
      this.cache = JSON.parse(readFileSync(join(this.cacheDir, "cache.json"), "utf-8"));
    } catch {
      this.cache = {};
    }
  }

  private saveCache(): void {
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(join(this.cacheDir, "cache.json"), JSON.stringify(this.cache, null, 2));
  }
}

function exportDirs(module: Module): string[] {
  if (module.content.headerUnits.length === 0) return [];
  return [join(module.outDir, DIRS.INCLUDE)];
}

function artifactPath(module: Module, tc: Toolchain): string | null {
  if (module.shape === PackageShape.Prebuilt || module.shape === PackageShape.HeaderOnly) {
    const target = module.content.artifactUnits.find(u => u.isArtifact);
    return target ? target.path : null;
  }
  const libType = module.requested ?? LinkType.Static;
  if (libType === LinkType.Shared) return sharedArtifactPath(module, tc);
  return join(module.outDir, `${module.name}.a`);
}

function sharedArtifactPath(module: Module, tc: Toolchain): string | null {
  const sExt = tc.sharedLibExt;
  if (!sExt || module.shape === PackageShape.HeaderOnly) return null;
  if (module.shape === PackageShape.Prebuilt) {
    const target = module.content.artifactUnits.find(u => u.ext === sExt);
    return target ? target.path : null;
  }
  return join(module.outDir, `${module.name}${sExt}`);
}

function relPath(fromDir: string, file: string): string {
  const from = fromDir.endsWith("/") ? fromDir : fromDir + "/";
  if (!file.startsWith(from)) throw new Error(`File ${file} is outside ${fromDir}`);
  return file.slice(from.length);
}

interface ExportPlan {
  unit: { path: string };
  rel: string;
}

function exportDestinations(module: Module): ExportPlan[] {
  const e = module.manifest.exports;
  if (!e) return [];
  const plans: ExportPlan[] = [];
  const units = new Map(module.content.headerUnits.map(u => [u.path, u]));

  const addMatch = (prefixSegs: number, file: string): void => {
    const unit = units.get(file);
    const rel = relPath(module.path, file);
    const parts = rel.split("/");
    const destRel = parts.slice(prefixSegs).join("/");
    if (unit && destRel) plans.push({ unit: { path: unit.path }, rel: destRel });
  };

  if (Array.isArray(e)) {
    // first path component is stripped
    for (const entry of e) {
      const abs = join(module.path, entry);
      if (existsSync(abs)) {
        if (statSync(abs).isDirectory()) {
          for (const u of module.content.headerUnits) {
            const rel = relPath(module.path, u.path);
            if (rel.startsWith(entry + "/")) {
              const destRel = rel.split("/").slice(1).join("/");
              plans.push({ unit: { path: u.path }, rel: destRel });
            }
          }
        } else {
          const rel = relPath(module.path, abs);
          const unit = units.get(abs);
          if (unit) plans.push({ unit: { path: abs }, rel: rel.split("/").slice(1).join("/") });
        }
      } else {
        // glob pattern relative to module root — best-effort prefix strip of first segment
        for (const u of module.content.headerUnits) {
          const rel = relPath(module.path, u.path);
          if (new Glob(entry).match(rel)) {
            plans.push({ unit: { path: u.path }, rel: rel.split("/").slice(1).join("/") });
          }
        }
      }
    }
    return plans;
  }

  // object form: entire prefix key is stripped
  for (const [prefix, patterns] of Object.entries(e)) {
    const base = join(module.path, prefix);
    for (const pattern of patterns) {
      if (!existsSync(base)) continue;
      for (const u of module.content.headerUnits) {
        const rel = relPath(module.path, u.path);
        if (!rel.startsWith(prefix + "/")) continue;
        const sub = rel.slice(prefix.length + 1);
        if (new Glob(pattern).match(sub)) {
          plans.push({ unit: { path: u.path }, rel: sub });
        }
      }
    }
  }
  return plans;
}
