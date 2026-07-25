import { existsSync, mkdirSync, cpSync, copyFileSync, readdirSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { basename, dirname, join, relative, resolve } from "path";
import type { CompileOptions, LinkOptions, CompileTask, LinkTask, ArchiveTask } from "./toolchain/types";
import { Toolchain } from "./toolchain/types";
import type { BuildResult, PackageJson } from "./types";
import { PackageShape, LinkType, BuildResultType } from "./types";
import { Manifest } from "./manifest";
import { Prebuilt } from "./prebuilt";
import { Dependency } from "./dependency";
import { globFiles } from "./glob";

function detectShape(pkgPath: string, pkg: PackageJson): PackageShape {
  const hasMain = existsSync(join(pkgPath, "src", "main.c"));
  const hasSrc = existsSync(join(pkgPath, "src"));
  const hasInclude = existsSync(join(pkgPath, "include"));
  const hasTarget = existsSync(join(pkgPath, "target"));

  const sources = pkg.sources ?? [];
  const hasSources = Array.isArray(sources) ? sources.length > 0 : Object.keys(sources).length > 0;
  const sourcesHasMain = Array.isArray(sources)
    ? sources.includes("main.c") || sources.some(s => s.endsWith("/main.c"))
    : false;

  if (hasMain || sourcesHasMain) return PackageShape.Executable;
  if (hasInclude && hasTarget && !hasSrc && !hasSources) return PackageShape.Prebuilt;
  if (hasSrc || hasSources) return PackageShape.Library;

  throw new Error(
    `Cannot determine package type for "${pkgPath}". ` +
      `Valid: src/main.c (executable), include/ + src/ (library), include/ + target/ (prebuilt).`
  );
}

function parseDependency(dep: string): { prefix: string; value: string; linkType?: LinkType; version?: string; pkg?: string } {
  let linkType: LinkType | undefined;

  if (dep.endsWith("+static")) {
    linkType = LinkType.Static;
    dep = dep.slice(0, -7);
  } else if (dep.endsWith("+shared") || dep.endsWith("+dynamic")) {
    linkType = LinkType.Shared;
    dep = dep.endsWith("+shared") ? dep.slice(0, -7) : dep.slice(0, -8);
  }

  const colonIdx = dep.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Invalid dependency format: "${dep}". Must use "prefix:value" syntax.`);
  }

  const prefix = dep.slice(0, colonIdx);
  let rest = dep.slice(colonIdx + 1);
  let version: string | undefined;
  let pkg: string | undefined;

  if (prefix === "git") {
    const atIdx = rest.indexOf("@");
    if (atIdx !== -1) {
      version = rest.slice(atIdx + 1);
      rest = rest.slice(0, atIdx);
    }
    const slashIdx = rest.indexOf("//");
    if (slashIdx !== -1) {
      pkg = rest.slice(slashIdx + 2);
      rest = rest.slice(0, slashIdx);
    }
  }

  return { prefix, value: rest, linkType, version, pkg };
}

function collectCFiles(dir: string, base?: string): string[] {
  const result: string[] = [];
  const baseDir = base ?? dir;
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectCFiles(abs, baseDir));
    } else if (entry.name.endsWith(".c")) {
      result.push(abs);
    }
  }
  return result;
}

export class Module {
  static ignoreCache = 0;
  static extraDefines: string[] = [];

  readonly path: string;
  readonly name: string;
  readonly isRoot: boolean;
  readonly root: Module;
  readonly parent: Module | null;
  type: PackageShape;
  manifest: PackageJson;
  deps: Dependency[];
  sources: string[];
  includePaths: string[];
  result: BuildResult | null = null;

  get outBase(): string {
    return this.isRoot ? this.path : join(this.root.path, ".shard", this.name);
  }

  get targetSubdir(): string {
    const td = this.tc!.targetDir;
    const variant = this.manifest.target;
    return variant ? join(td, variant) : td;
  }

  private tc: Toolchain | undefined;
  constructor(path: string, tc?: Toolchain, parent?: Module) {
    this.path = resolve(path);
    this.name = basename(this.path);
    this.parent = parent ?? null;
    this.root = parent?.root ?? this;
    this.isRoot = !parent;
    this.tc = tc;
    this.includePaths = [];
    this.deps = [];
    this.sources = [];
    this.manifest = {} as PackageJson;
    this.type = PackageShape.Library;
  }

  load(): void {
    const pkg = Manifest.parse(this.path, this.tc, Module.extraDefines);
    this.type = detectShape(this.path, pkg);
    this.manifest = pkg;

    this.deps.length = 0;
    for (const raw of (pkg.depend ?? [])) {
      const { prefix, value, linkType, version, pkg: pkgName } = parseDependency(raw);
      this.deps.push(new Dependency(raw, prefix, value, linkType, version, pkgName));
    }

    this.sources.length = 0;
    if (this.type !== PackageShape.Prebuilt) {
      if (pkg.sources) {
        if (Array.isArray(pkg.sources)) {
          for (const f of pkg.sources) {
            const abs = join(this.path, f);
            if (existsSync(abs) && statSync(abs).isDirectory()) {
              this.sources.push(...collectCFiles(abs));
            } else if (f.endsWith(".c")) {
              this.sources.push(abs);
            }
          }
        } else {
          for (const [prefix, patterns] of Object.entries(pkg.sources)) {
            const base = join(this.path, prefix);
            for (const pattern of patterns) {
              if (pattern.includes("*")) {
                if (!existsSync(base)) continue;
                for (const rel of globFiles(base, pattern)) {
                  const abs = join(base, rel);
                  if (existsSync(abs) && statSync(abs).isDirectory()) {
                    this.sources.push(...collectCFiles(abs));
                  } else if (abs.endsWith(".c")) {
                    this.sources.push(abs);
                  }
                }
              } else {
                const abs = join(base, pattern);
                if (existsSync(abs) && statSync(abs).isDirectory()) {
                  this.sources.push(...collectCFiles(abs));
                } else if (pattern.endsWith(".c") || abs.endsWith(".c")) {
                  this.sources.push(abs);
                }
              }
            }
          }
        }
      } else {
        const srcDir = join(this.path, "src");
        if (existsSync(srcDir)) this.sources.push(...collectCFiles(srcDir));
      }
    }

    this.includePaths.length = 0;
    if (pkg.includes) {
      if (Array.isArray(pkg.includes)) {
        for (const p of pkg.includes) {
          this.includePaths.push(join(this.path, p));
        }
      } else {
        for (const [prefix] of Object.entries(pkg.includes)) {
          this.includePaths.push(join(this.path, prefix));
        }
      }
    }
    if (pkg.exports) {
      const items = Array.isArray(pkg.exports) ? pkg.exports : Object.keys(pkg.exports);
      for (const p of items) {
        this.includePaths.push(join(this.path, p));
      }
    }
  }

  async update(): Promise<void> {
    const visited = new Set<string>();
    this.install(visited);
    Dependency.clean(this.path, visited);
  }

  private install(visited?: Set<string>): void {
    if (visited?.has(this.path)) return;
    visited?.add(this.path);
    for (const dep of this.deps) {
      if (dep.isSystem) continue;
      const depPath = dep.install(this.root.path, this.path);
      const child = new Module(depPath, this.tc, this);
      child.load();
      dep.module = child;
      child.install(visited);
    }
  }

  info(): void {
    Manifest.info(this);
  }

  private copyExports(targetInc: string): void {
    const items = this.manifest.exports;
    if (!items) return;

    if (Array.isArray(items)) {
      for (const item of items) {
        const src = join(this.path, item);
        if (!existsSync(src)) continue;

        const parts = item.split("/");
        const rel = parts.slice(1).join("/");
        const dst = rel ? join(targetInc, rel) : targetInc;

        if (statSync(src).isDirectory()) {
          cpSync(src, dst, { recursive: true });
        } else {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
        }
      }
      return;
    }

    for (const [prefix, patterns] of Object.entries(items)) {
      const base = join(this.path, prefix);
      if (!existsSync(base)) continue;
      for (const pattern of patterns) {
        for (const rel of globFiles(base, pattern)) {
          const src = join(base, rel);
          const dst = join(targetInc, rel);
          if (statSync(src).isDirectory()) {
            cpSync(src, dst, { recursive: true });
          } else {
            mkdirSync(dirname(dst), { recursive: true });
            copyFileSync(src, dst);
          }
        }
      }
    }
  }

  runScript(name: string): void {
    const cmd = this.manifest.scripts?.[name];
    if (!cmd) throw new Error(`Script "${name}" not defined in shard.json`);
    const r = spawnSync(cmd, [], { stdio: "inherit", shell: true, cwd: this.path });
    if (r.status !== 0) throw new Error(`Script "${name}" failed`);
  }

  private runHook(name: string): void {
    const cmd = this.manifest.scripts?.[name];
    if (!cmd) return;
    const r = spawnSync(cmd, [], { stdio: "inherit", shell: true, cwd: this.path });
    if (r.status !== 0) throw new Error(`"${name}" hook failed`);
  }

  async build(requestedLinkType?: LinkType): Promise<BuildResult> {
    if (this.result) return this.result;

    if (!this.tc) {
      throw new Error("Toolchain not available");
    }

    const collect = (a: string[], v: string | null): void => { if (v != null && !a.includes(v)) a.push(v); };

    const includePaths: string[] = [];
    const libPaths: string[] = [];
    const libFlags: string[] = [];
    const sharedLibs: string[] = [];

    for (const dep of this.deps) {
      if (dep.isSystem) {
        libFlags.push(...dep.getLinkerFlags());
        continue;
      }
      await dep.module!.build(dep.linkType);
      const r = dep.module!.result!;
      for (const ip of r.includePaths) collect(includePaths, ip);
      for (const lp of r.libPaths) collect(libPaths, lp);
      for (const f of r.sysLibs) collect(libFlags, f);
      for (const s of r.sharedLibs) collect(sharedLibs, s);
    }

    this.runHook("prebuild");

    for (const p of this.includePaths) {
      if (existsSync(p) && statSync(p).isDirectory()) collect(includePaths, p);
    }
    if (this.manifest.sources) {
      if (Array.isArray(this.manifest.sources)) {
        for (const s of this.manifest.sources) {
          const abs = join(this.path, s);
          if (existsSync(abs) && statSync(abs).isDirectory()) collect(includePaths, abs);
        }
      } else {
        for (const [prefix] of Object.entries(this.manifest.sources)) {
          const abs = join(this.path, prefix);
          if (existsSync(abs) && statSync(abs).isDirectory()) collect(includePaths, abs);
        }
      }
    } else {
      const srcDir = join(this.path, "src");
      if (existsSync(srcDir)) collect(includePaths, srcDir);
    }

    if (this.type === PackageShape.Prebuilt) {
      this.result = this.buildPrebuilt(libFlags, requestedLinkType);
    } else {
      const opts = this.compileOptions(includePaths);
      const allTasks = this.createCompileTasks(opts);

      if (!this.tc.cacheDir) {
        this.tc.cacheDir = join(this.root.path, ".shard");
        this.tc.loadCache();
      }

      const mode = Module.ignoreCache;
      const useCache = mode === 0 || (mode === 1 && !this.isRoot);
      const cacheName = this.isRoot ? Toolchain.ROOT_CACHE_ALIAS : this.name;
      await this.tc.compileTasks(allTasks, cacheName, useCache, this.path, this.name);

      this.result = this.link(allTasks.map(t => t.object), libPaths, libFlags, sharedLibs, requestedLinkType);
    }

    const hasExports = this.manifest.exports && (Array.isArray(this.manifest.exports) ? this.manifest.exports.length > 0 : Object.keys(this.manifest.exports).length > 0);
    if (hasExports) {
      const targetInc = join(this.outBase, "target", this.targetSubdir, "include");
      this.copyExports(targetInc);
      this.result.includePaths = [targetInc];
    } else {
      this.result.includePaths = [];
    }
    this.runHook("postbuild");
    return this.result;
  }

  compileOptions(includePaths: string[]): CompileOptions {
    const o = this.manifest.options;
    return {
      includePaths,
      optimize: o?.optimize ? (`-O${o.optimize}` as const) : undefined,
      debug: o?.debug,
      standard: o?.standard ? (`-std=${o.standard}` as const) : undefined,
      warnings: o?.warnings,
      defines: [...(o?.defines ?? []), ...Module.extraDefines],
      extra: o?.compileExtra,
    };
  }

  private linkOptions(libPaths: string[], libFlags: string[]): LinkOptions {
    const o = this.manifest.options;
    return { libPaths, libFlags, subsystem: o?.subsystem, extra: o?.linkExtra };
  }

  private createCompileTasks(opts: CompileOptions): CompileTask[] {
    return this.sources.map(src => {
      const rel = relative(this.path, src).replace(/\.c$/, ".o");
      const prefix = this.isRoot ? Toolchain.ROOT_CACHE_ALIAS : this.name;
      const obj = join(this.root.path, ".shard", prefix, rel);
      return { source: src, object: obj, relPath: rel, opts };
    });
  }

  private buildPrebuilt(libFlags: string[], requested?: LinkType): BuildResult {
    const { libPath, available, runtimePath } = Prebuilt.detect(this.path, this.name, this.tc!, requested, this.manifest.target);
    const linkType = Prebuilt.selectBuildType(requested, available, this.name);
    return {
      type: linkType === LinkType.Shared ? BuildResultType.SharedLib : BuildResultType.StaticLib,
      includePaths: [...this.includePaths],
      libPaths: libPath ? [libPath] : [],
      executablePath: null,
      linkType,
      sharedLibs: linkType === LinkType.Shared && runtimePath ? [runtimePath] : [],
      sysLibs: libFlags,
    };
  }

  private link(objects: string[], libPaths: string[], libFlags: string[], sharedLibs: string[], requestedLinkType?: LinkType): BuildResult {
    const linkOpts = this.linkOptions(libPaths, libFlags);
    const pkgName = this.name;

    if (this.type === PackageShape.Executable) {
      const output = join(this.outBase, "target", this.targetSubdir, `${pkgName}${this.tc!.exeExt}`);
      if (!existsSync(join(this.outBase, "target", this.targetSubdir))) mkdirSync(join(this.outBase, "target", this.targetSubdir), { recursive: true });
      this.tc!.link({ target: "executable", objects, output, opts: linkOpts });

      for (const sl of sharedLibs) {
        copyFileSync(sl, join(dirname(output), basename(sl)));
      }

      return {
        type: BuildResultType.Executable, includePaths: [...this.includePaths], libPaths: [],
        executablePath: output, linkType: null,
        sharedLibs, sysLibs: [...libFlags],
      };
    }

    const actualType = requestedLinkType ?? LinkType.Static;
    const result = this.buildLibrary(objects, libPaths, libFlags, sharedLibs, actualType, pkgName, linkOpts);

    if (this.isRoot) {
      const otherType = actualType === LinkType.Static ? LinkType.Shared : LinkType.Static;
      this.buildLibrary(objects, libPaths, libFlags, sharedLibs, otherType, pkgName, linkOpts);
    }

    return result;
  }

  private buildLibrary(objects: string[], libPaths: string[], libFlags: string[], sharedLibs: string[], linkType: LinkType, pkgName: string, linkOpts: LinkOptions): BuildResult {
    if (linkType === LinkType.Static) {
      const output = join(this.outBase, "target", this.targetSubdir, `${pkgName}${this.tc!.staticLibExt}`);
      if (!existsSync(join(this.outBase, "target", this.targetSubdir))) mkdirSync(join(this.outBase, "target", this.targetSubdir), { recursive: true });
      this.tc!.archive({ objects, output });
      return {
        type: BuildResultType.StaticLib, includePaths: [...this.includePaths], libPaths: [output, ...libPaths],
        executablePath: null, linkType: LinkType.Static,
        sharedLibs: [...sharedLibs], sysLibs: [...libFlags],
      };
    }

    const sExt = this.tc!.sharedLibExt;
    if (!sExt) throw new Error(`Shared libraries not supported on target "${this.tc!.currentTarget.platform}"`);
    const output = join(this.outBase, "target", this.targetSubdir, `${pkgName}${sExt}`);
    if (!existsSync(join(this.outBase, "target", this.targetSubdir))) mkdirSync(join(this.outBase, "target", this.targetSubdir), { recursive: true });
    this.tc!.link({ target: "shared", objects, output, opts: linkOpts });
    const resultSharedLibs = [...sharedLibs];
    if (!resultSharedLibs.includes(output)) resultSharedLibs.unshift(output);
    return {
      type: BuildResultType.SharedLib, includePaths: [...this.includePaths],
      libPaths: this.tc!.importLibExt ? [join(this.outBase, "target", this.targetSubdir, `${pkgName}${this.tc!.importLibExt}`)] : [output],
      executablePath: null, linkType: LinkType.Shared,
      sharedLibs: resultSharedLibs, sysLibs: [],
    };
  }
}
