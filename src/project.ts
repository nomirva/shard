import { existsSync, readdirSync, rmSync } from "fs";
import { join, sep } from "path";
import { detectClangToolchain } from "./clang";
import type { Toolchain } from "./toolchain";
import { Module } from "./module";
import { Builder } from "./builder";
import { DIRS } from "./constants";
import type { InstallProgress, InstallResult, ProgressSink, ResolveContext } from "./dependency";
import { requireScript, runHook } from "./scripts";

const DRAW_INTERVAL_MS = 80;
const DRAW_GRACE_MS = 150;

export interface ProjectConfig {
  defines?: string[];
  ignoreCache?: number;
  gitProtocol?: string;
  progress?: ProgressSink;
}

export class Project {
  readonly rootPath: string;
  readonly toolchain: Toolchain;
  readonly rootModule: Module;
  config: ProjectConfig;

  constructor(rootPath: string, config: ProjectConfig = {}) {
    this.rootPath = rootPath;
    this.config = config;
    this.toolchain = detectClangToolchain();
    this.rootModule = new Module(rootPath);
  }

  async build(): Promise<void> {
    await this.resolve();
    const builder = new Builder(this.toolchain, this.rootPath, this.config.defines ?? [], this.config.ignoreCache ?? 0);
    const modules = this.collectPostOrder(this.rootModule);
    await builder.buildModules(modules);
  }

  async update(): Promise<void> {
    await this.resolve();
    this.clean();
  }

  info(): void {
    this.rootModule.load(this.toolchain, this.config.defines);
    const deps = this.rootModule.deps;
    console.log(`\n  Name: ${this.rootModule.manifest.name ?? this.rootModule.name}`);
    console.log(`  Type: ${this.rootModule.shape}`);
    const dirs = this.rootModule.extract().includeDirs;
    console.log(`  Include: ${dirs[0] ?? "(none)"}`);
    if (deps.length) {
      console.log(`  Dependencies (${deps.length}):`);
      for (const d of deps) {
        console.log(`    - ${d.describe()}`);
      }
    } else {
      console.log(`  Dependencies: none`);
    }
  }

  executablePath(): string | null {
    if (this.rootModule.shape !== "executable") return null;
    const exeExt = this.toolchain.exeExt ?? "";
    return join(this.rootModule.outDir, `${this.rootModule.name}${exeExt}`);
  }

  runScript(name: string): void {
    this.rootModule.load(this.toolchain, this.config.defines);
    requireScript(this.rootPath, this.rootModule.manifest.scripts, name);
  }

  cleanAll(): void {
    this.rootModule.load(this.toolchain, this.config.defines);
    runHook(this.rootPath, this.rootModule.manifest.scripts, "preclean");
    const shardDir = join(this.rootPath, DIRS.SHARD);
    const modulesDir = join(this.rootPath, DIRS.MODULES);
    const targetDir = join(this.rootPath, DIRS.TARGET);
    for (const d of [shardDir, modulesDir, targetDir]) {
      if (existsSync(d)) {
        rmSync(d, { recursive: true, force: true });
        console.log(`  removed: ${d}`);
      }
    }
  }

  private async resolve(): Promise<void> {
    const visited = new Set<string>();
    await this.resolveModule(this.rootModule, visited);
  }

  private async resolveModule(module: Module, visited: Set<string>): Promise<void> {
    if (visited.has(module.path)) return;
    visited.add(module.path);

    module.load(this.toolchain, this.config.defines);
    const total = module.deps.length;

    for (let i = 0; i < total; i++) {
      const dep = module.deps[i];
      const result = await this.installOne(dep.name, dep.version, i + 1, total, module.path, (ctx) =>
        dep.install(ctx),
      );

      if ("module" in result) {
        const child = result.module;
        child.parent = module;
        child.requested = dep.link ?? null;
        module.children.push(child);
        await this.resolveModule(child, visited);
      } else {
        module.libFlags.push(...result.flags);
      }
    }
  }

  private async installOne(
    name: string,
    version: string | null,
    index: number,
    total: number,
    from: string,
    run: (ctx: ResolveContext) => Promise<InstallResult>,
  ): Promise<InstallResult> {
    const sink = this.config.progress;
    const progress: InstallProgress = { name, version, percent: 0 };
    let started = false;
    let finished = false;

    const draw = (): void => {
      if (!started) return;
      sink?.line({ name, version, index, total, percent: progress.percent });
    };
    const ensureStarted = (): void => {
      if (!started && !finished) {
        started = true;
        draw();
      }
    };

    const interval = setInterval(() => {
      if (started) draw();
      else if (progress.percent > 0) ensureStarted();
    }, DRAW_INTERVAL_MS);
    const grace = setTimeout(ensureStarted, DRAW_GRACE_MS);

    try {
      const ctx = { project: this, from, progress, index, total };
      const result = await run(ctx);
      finished = true;
      return result;
    } finally {
      finished = true;
      clearInterval(interval);
      clearTimeout(grace);
      if (started) {
        draw();
        sink?.end();
      }
    }
  }

  private collectPostOrder(module: Module): Module[] {
    const out: Module[] = [];
    const walk = (m: Module): void => {
      for (const child of m.children) walk(child);
      out.push(m);
    };
    walk(module);
    return out;
  }

  private clean(): void {
    const active = new Set<string>();
    const collectPaths = (m: Module): void => {
      active.add(m.path);
      for (const child of m.children) collectPaths(child);
    };
    collectPaths(this.rootModule);

    const modulesDir = join(this.rootPath, DIRS.MODULES);
    if (!existsSync(modulesDir)) return;
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(modulesDir, entry.name);
      const isActive = active.has(full) || [...active].some(p => p.startsWith(full + sep));
      if (!isActive) rmSync(full, { recursive: true, force: true });
    }
  }
}
