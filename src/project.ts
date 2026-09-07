import { spawnSync } from "child_process";
import { existsSync, readdirSync, rmSync } from "fs";
import { join, sep } from "path";
import chalk from "chalk";
import { detectClangToolchain, Toolchain } from "./clang";
import { Module } from "./module";
import { Builder } from "./builder";
import { DIRS } from "./constants";

export interface ProjectConfig {
  defines?: string[];
  ignoreCache?: number;
  gitProtocol?: string;
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
    this.resolve();
    const builder = new Builder(this.toolchain, this.rootPath, this.config.defines ?? [], this.config.ignoreCache ?? 0);
    const modules = this.collectPostOrder(this.rootModule);
    await builder.buildModules(modules);
  }

  async update(): Promise<void> {
    this.resolve();
    this.clean();
  }

  doctor(): boolean {
    const ok = this.toolchain.detect();
    const info = this.toolchain.info();
    console.log(`\n [Toolchain]`);
    if (ok) {
      console.log(` ${info.name.padEnd(6)}${info.version}`);
    } else {
      console.log(` ${info.name.padEnd(6)}${chalk.red("✗")} not found`);
    }

    const r = spawnSync("git", ["--version"], { stdio: "pipe" });
    const gitOk = r.status === 0;
    console.log(`\n [Version Control]`);
    if (gitOk) {
      console.log(` git   ${(r.stdout?.toString() ?? "").trim()}`);
    } else {
      console.log(` git   ${chalk.red("✗")} not found`);
    }

    if (ok && gitOk) {
      console.log("\n " + chalk.bgGreen.black.bold(" READY TO USE "));
    } else {
      console.log("\n " + chalk.bgRed.black.bold(" NOT READY TO USE "));
    }
    console.log();
    return ok && gitOk;
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
        console.log(`    - ${d.label}`);
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
    const cmd = this.rootModule.manifest.scripts?.[name];
    if (!cmd) throw new Error(`Script "${name}" not defined in shard.json`);
    const r = spawnSync(cmd, [], { stdio: "inherit", shell: true, cwd: this.rootPath });
    if (r.status !== 0) throw new Error(`"${name}" failed`);
  }

  cleanAll(): void {
    this.rootModule.load(this.toolchain, this.config.defines);
    const preclean = this.rootModule.manifest.scripts?.preclean;
    if (preclean) {
      const r = spawnSync(preclean, [], { stdio: "inherit", shell: true, cwd: this.rootPath });
      if (r.status !== 0) throw new Error("preclean hook failed");
    }
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

  private resolve(): void {
    const visited = new Set<string>();
    this.resolveModule(this.rootModule, visited);
  }

  private resolveModule(module: Module, visited: Set<string>): void {
    if (visited.has(module.path)) return;
    visited.add(module.path);

    module.load(this.toolchain, this.config.defines);
    for (const dep of module.deps) {
      const child = dep.install(this, module);
      if (!child) continue;
      child.parent = module;
      child.requested = dep.linkType ?? null;
      module.children.push(child);
      this.resolveModule(child, visited);
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
