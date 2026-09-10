import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Glob } from "bun";
import chalk from "chalk";
import { PackageShape, LinkType } from "./types";
import { CompileTask, CompileOptions, Toolchain, UserBuildOptions } from "./toolchain";
import { Module } from "./module";
import { DIRS } from "./constants";
import { runHook } from "./scripts";
import { ShardError } from "./errors";

interface TransitiveInfo {
  includeDirs: string[];
  libPaths: string[];
  flags: string[];
  sharedLibs: string[];
}

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
    runHook(module.path, module.manifest.scripts, "prebuild");
    module.refreshContent();

    if (module.shape === PackageShape.Prebuilt) {
      this.buildPrebuilt(module);
    } else if (module.shape === PackageShape.HeaderOnly) {
      // nothing to compile or link
    } else {
      const info = this.transitiveInfo(module);
      const objects = await this.compileModule(module, info.includeDirs);
      this.linkModule(module, objects, info);
    }

    this.exportHeaders(module);
    runHook(module.path, module.manifest.scripts, "postbuild");
  }

  private async compileModule(module: Module, includeDirs: string[]): Promise<string[]> {
    const useCache = this.ignoreCache === 0 || (this.ignoreCache === 1 && !module.isRoot);
    const prefix = module.isRoot ? "_" : module.name;
    const objects: string[] = [];

    for (const source of module.content.sourceUnits) {
      const rel = relPath(module.path, source.path).replace(/\.c$/, ".o");
      const object = join(this.cacheDir, prefix, rel);
      const task: CompileTask = {
        source,
        object,
        relPath: rel,
        options: this.compileOptions(module, includeDirs),
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

  private linkModule(module: Module, objects: string[], info: TransitiveInfo): void {
    const o = optionsOf(module);
    const requested = module.requested ?? LinkType.Static;
    const libFlags = [...info.flags, ...module.libFlags];

    if (module.shape === PackageShape.Executable) {
      const output = join(module.outDir, `${module.name}${this.toolchain.exeExt ?? ""}`);
      mkdirSync(dirname(output), { recursive: true });
      this.toolchain.link({
        kind: "executable",
        objects,
        output,
        options: {
          libPaths: info.libPaths,
          libFlags,
          subsystem: o.subsystem,
          extra: o.linkExtra,
        },
      });
      for (const sl of info.sharedLibs) {
        copyFileSync(sl, join(dirname(output), sl.split("/").pop()!));
      }
      return;
    }

    this.buildLibrary(module, objects, requested, libFlags, info.libPaths);
    if (module.isRoot && module.shape === PackageShape.Library) {
      const other = requested === LinkType.Static ? LinkType.Shared : LinkType.Static;
      this.buildLibrary(module, objects, other, libFlags, info.libPaths);
    }
  }

  private buildLibrary(
    module: Module,
    objects: string[],
    linkType: LinkType,
    libFlags: string[],
    libPaths: string[],
  ): void {
    const o = optionsOf(module);
    mkdirSync(module.outDir, { recursive: true });

    if (linkType === LinkType.Static) {
      const output = join(module.outDir, `${module.name}.a`);
      this.toolchain.archive({ objects, output });
      return;
    }

    const sExt = this.toolchain.sharedLibExt;
    if (!sExt) {
      throw new ShardError(
        "build",
        `Shared libraries not supported on platform "${this.toolchain.currentTarget.platform}"`,
        "request static linking or use a supported platform",
      );
    }
    const output = join(module.outDir, `${module.name}${sExt}`);
    this.toolchain.link({
      kind: "shared",
      objects,
      output,
      options: {
        libPaths,
        libFlags,
        subsystem: o.subsystem,
        extra: o.linkExtra,
      },
    });
  }

  private buildPrebuilt(module: Module): void {
    if (!existsSync(module.outDir)) {
      throw new ShardError(
        "build",
        `Invalid prebuilt package "${module.name}": expected libraries at "${module.outDir}"`,
        "check the module layout or exports field",
      );
    }
  }

  private compileOptions(module: Module, transitiveIncludeDirs: string[]): CompileOptions {
    const o = optionsOf(module);
    const includePaths = [...transitiveIncludeDirs];
    for (const d of module.extract().includeDirs) {
      if (!includePaths.includes(d)) includePaths.push(d);
    }
    return {
      includePaths,
      optimize: o.optimize ? (`-O${o.optimize}` as const) : undefined,
      debug: o.debug,
      standard: o.standard ? (`-std=${o.standard}` as const) : undefined,
      warnings: o.warnings,
      defines: [...(o.defines ?? []), ...this.extraDefines],
      extra: o.compileExtra,
    };
  }

  private transitiveInfo(module: Module): TransitiveInfo {
    const includeDirs: string[] = [];
    const libPaths: string[] = [];
    const flags: string[] = [];
    const sharedLibs: string[] = [];

    const pushUnique = (arr: string[], v: string): void => {
      if (!arr.includes(v)) arr.push(v);
    };

    const walk = (m: Module): void => {
      for (const child of m.children) {
        for (const d of exportDirs(child)) pushUnique(includeDirs, d);
        const lib = artifactPath(child, this.toolchain);
        if (lib) pushUnique(libPaths, lib);
        flags.push(...child.libFlags);
        const shared = sharedArtifactPath(child, this.toolchain);
        if (shared && existsSync(shared)) pushUnique(sharedLibs, shared);
        walk(child);
      }
    };
    walk(module);

    return { includeDirs, libPaths, flags, sharedLibs };
  }

  private exportHeaders(module: Module): void {
    if (module.content.headerUnits.length === 0) return;
    const destRoot = join(module.outDir, DIRS.INCLUDE);
    for (const { unit, rel } of exportDestinations(module)) {
      const dst = join(destRoot, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(unit.path, dst);
    }
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

function optionsOf(module: Module): UserBuildOptions {
  return (module.manifest.options ?? {}) as UserBuildOptions;
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
  const relOf = (file: string): string => relPath(module.path, file);
  const add = (unitPath: string, rel: string): void => {
    if (rel) plans.push({ unit: { path: unitPath }, rel });
  };

  if (Array.isArray(e)) {
    // first path component is stripped from every destination
    for (const entry of e) {
      const abs = join(module.path, entry);
      const isDir = existsSync(abs) && statSync(abs).isDirectory();
      for (const u of module.content.headerUnits) {
        const rel = relOf(u.path);
        const hit = isDir
          ? rel.startsWith(entry + "/")
          : !hasGlobMeta(entry) && existsSync(abs)
            ? rel === entry
            : new Glob(entry).match(rel);
        if (hit) add(u.path, rel.split("/").slice(1).join("/"));
      }
    }
    return plans;
  }

  // object form: entire prefix key is stripped; a non-glob pattern that is a
  // directory exports that subtree recursively
  for (const [prefix, patterns] of Object.entries(e)) {
    for (const pattern of patterns) {
      const key = prefix + "/" + pattern;
      const abs = join(module.path, key);
      const isDir = existsSync(abs) && statSync(abs).isDirectory();
      for (const u of module.content.headerUnits) {
        const rel = relOf(u.path);
        const sub = rel.startsWith(prefix + "/") ? rel.slice(prefix.length + 1) : "";
        const hit = isDir
          ? rel.startsWith(key + "/")
          : hasGlobMeta(pattern)
            ? !!sub && new Glob(pattern).match(sub)
            : rel === key;
        if (hit) add(u.path, sub);
      }
    }
  }
  return plans;
}

function hasGlobMeta(s: string): boolean {
  return /[*?[\]]/.test(s);
}
