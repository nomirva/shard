import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import type { Toolchain, CompileOptions, LinkOptions, CompileTask, LinkTask, ArchiveTask } from "./toolchain/types";
import type { BuildResult, PackageJson } from "./types";
import { PackageShape, LinkType, BuildResultType } from "./types";
import { Manifest } from "./manifest";
import { Prebuilt } from "./prebuilt";
import { Dependency } from "./dependency";

const addFlags = <T>(a: T[], v: T) => { if (v != null && !a.includes(v)) a.push(v); };

function detectShape(pkgPath: string): PackageShape {
  const hasMain = existsSync(join(pkgPath, "src", "main.c"));
  const hasSrc = existsSync(join(pkgPath, "src"));
  const hasInclude = existsSync(join(pkgPath, "include"));
  const hasLib = existsSync(join(pkgPath, "lib"));

  if (hasMain) return PackageShape.Executable;
  if (hasInclude && hasSrc && !hasMain) return PackageShape.Library;
  if (hasInclude && hasLib && !hasSrc) return PackageShape.Prebuilt;

  throw new Error(
    `Cannot determine package type for "${pkgPath}". ` +
      `Valid: src/main.c (executable), include/ + src/ (library), include/ + lib/ (prebuilt).`
  );
}

function parseDependency(dep: string): { prefix: string; value: string; linkType?: LinkType; version?: string } {
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

  let value = dep.slice(colonIdx + 1);
  let version: string | undefined;

  const hashIdx = value.indexOf("#");
  if (hashIdx !== -1) {
    version = value.slice(hashIdx + 1);
    value = value.slice(0, hashIdx);
  }

  return { prefix: dep.slice(0, colonIdx), value, linkType, version };
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
    const pkg = Manifest.parse(this.path, this.tc);
    this.type = detectShape(this.path);
    this.manifest = pkg;

    this.deps.length = 0;
    for (const raw of (pkg.depend ?? [])) {
      const { prefix, value, linkType, version } = parseDependency(raw);
      this.deps.push(new Dependency(raw, prefix, value, linkType, version));
    }

    this.sources.length = 0;
    if (this.type !== PackageShape.Prebuilt) {
      if (pkg.sources?.length) {
        for (const f of pkg.sources) this.sources.push(join(this.path, f));
      } else {
        const srcDir = join(this.path, "src");
        if (existsSync(srcDir)) this.sources.push(...collectCFiles(srcDir));
      }
    }

    this.includePaths.length = 0;
    if (pkg.includes?.length) {
      for (const p of pkg.includes) this.includePaths.push(join(this.path, p));
    } else {
      this.includePaths.push(join(this.path, "include"));
    }
  }

  async update(): Promise<void> {
    this.install();
    const visited = new Set<string>();
    this.resolve(visited);
    Dependency.clean(this.path, visited);
  }

  private install(): void {
    for (const dep of this.deps) {
      if (dep.isSystem) continue;
      const depPath = dep.install(this.root.path, this.path);
      const child = new Module(depPath, this.tc, this);
      child.load();
      dep.module = child;
    }
  }

  private resolve(visited: Set<string>): void {
    if (visited.has(this.path)) return;
    visited.add(this.path);
    for (const dep of this.deps) {
      if (dep.isSystem || !dep.module) continue;
      dep.module.install();
      dep.module.resolve(visited);
    }
  }

  info(): void {
    Manifest.info(this);
  }

  async build(requestedLinkType?: LinkType): Promise<BuildResult> {
    if (this.result) return this.result;

    if (!this.tc) {
      throw new Error("Toolchain not available");
    }

    const includePaths: string[] = [];
    const libPaths: string[] = [];
    const libFlags: string[] = [];
    const sharedLibs: string[] = [];

    for (const dep of this.deps) {
      if (dep.isSystem) {
        const flag = dep.libFlag;
        if (flag) addFlags(libFlags, flag);
        continue;
      }
      await dep.module!.build(dep.linkType);
      const r = dep.module!.result!;
      for (const ip of r.includePaths) addFlags(includePaths, ip);
      for (const lp of r.libPaths) addFlags(libPaths, lp);
      for (const f of r.sysLibs) addFlags(libFlags, f);
      for (const s of r.sharedLibs) addFlags(sharedLibs, s);
    }

    for (const p of this.includePaths) addFlags(includePaths, p);
    const srcDir = join(this.path, "src");
    if (existsSync(srcDir)) addFlags(includePaths, srcDir);

    if (this.type === PackageShape.Prebuilt) {
      this.result = this.buildPrebuilt(libFlags, requestedLinkType);
      return this.result;
    }

    const opts = this.compileOptions(includePaths);
    const allTasks = this.createCompileTasks(opts);

    const cacheDir = join(this.path, ".cache");
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    if (!this.tc.cacheDir) {
      this.tc.cacheDir = join(this.root.path, ".cache");
      this.tc.loadCache();
    }

    const mode = Module.ignoreCache;
    const useCache = mode === 0 || (mode === 1 && !this.isRoot);
    await this.tc.compileTasks(allTasks, this.name, useCache, this.path);

    this.result = this.link(allTasks.map(t => t.object), libPaths, libFlags, sharedLibs, requestedLinkType);
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
      defines: o?.defines,
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
      const obj = join(this.path, ".cache", rel);
      return { source: src, object: obj, relPath: rel, opts };
    });
  }

  private buildPrebuilt(libFlags: string[], requested?: LinkType): BuildResult {
    const { libPath, available, runtimePath } = Prebuilt.detect(this.path, this.name, this.tc!, requested);
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
      const output = join(this.path, "bin", `${pkgName}${this.tc!.exeExt}`);
      if (!existsSync(join(this.path, "bin"))) mkdirSync(join(this.path, "bin"), { recursive: true });
      this.tc!.link({ target: "executable", objects, output, opts: linkOpts });

      for (const dep of this.deps) {
        const r = dep.module?.result;
        if (!r || r.linkType === LinkType.Static) continue;
        for (const sl of r.sharedLibs)
          copyFileSync(sl, join(dirname(output), basename(sl)));
      }

      return {
        type: BuildResultType.Executable, includePaths: [...this.includePaths], libPaths: [],
        executablePath: output, linkType: null,
        sharedLibs, sysLibs: [],
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
      const output = join(this.path, "lib", `${pkgName}${this.tc!.staticLibExt}`);
      if (!existsSync(join(this.path, "lib"))) mkdirSync(join(this.path, "lib"), { recursive: true });
      this.tc!.archive({ objects, output });
      return {
        type: BuildResultType.StaticLib, includePaths: [...this.includePaths], libPaths: [output, ...libPaths],
        executablePath: null, linkType: LinkType.Static,
        sharedLibs: [...sharedLibs], sysLibs: [...libFlags],
      };
    }

    const sExt = this.tc!.sharedLibExt;
    if (!sExt) throw new Error(`Shared libraries not supported on target "${this.tc!.currentTarget.platform}"`);
    const output = join(this.path, "lib", `${pkgName}${sExt}`);
    if (!existsSync(join(this.path, "lib"))) mkdirSync(join(this.path, "lib"), { recursive: true });
    this.tc!.link({ target: "shared", objects, output, opts: linkOpts });
    const resultSharedLibs = [...sharedLibs];
    if (!resultSharedLibs.includes(output)) resultSharedLibs.unshift(output);
    return {
      type: BuildResultType.SharedLib, includePaths: [...this.includePaths],
      libPaths: this.tc!.importLibExt ? [join(this.path, "lib", `${pkgName}${this.tc!.importLibExt}`)] : [output],
      executablePath: null, linkType: LinkType.Shared,
      sharedLibs: resultSharedLibs, sysLibs: [],
    };
  }
}
