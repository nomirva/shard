import { Command, Option } from "commander";
import { spawnSync } from "child_process";
import { existsSync, readdirSync, rmSync } from "fs";
import { basename, join, resolve, sep } from "path";
import chalk from "chalk";
import pkg from "../../package.json" with { type: "json" };
import { loadManifest, type ConditionalContext } from "../module/manifest";
import { Module } from "../module/module";
import { materialize, scan } from "../module/materialize";
import { privateIncludes } from "../module/content";
import { checkCompatibility, resolveStandards } from "../module/compat";
import { PROFILE_NAMES } from "../module/profiles";
import type { Profile } from "../module/types";
import { createClangToolchain } from "../toolchain/clang";
import { Resolver } from "../dependency/resolver";
import { describeDependency, parseDependencies } from "../dependency/dependency";
import { Builder, executablePath } from "../builder/builder";
import { DIRS } from "../utils/constants";
import { ShardError, reportError } from "../utils/errors";
import { requireScript, runHook } from "../utils/scripts";
import { createProgressSink } from "./progress";
import { runDoctor } from "./doctor";

interface BuildOptions {
  ignoreCache?: string;
  start?: boolean;
  def?: string[];
  gitProtocol?: string;
  profile?: Profile;
}

function act(fn: (...args: any[]) => void | Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e: unknown) {
      reportError(e);
      process.exit(1);
    }
  };
}

function context(compiler: string, defines: string[]): ConditionalContext {
  return { compiler, platform: process.platform, arch: process.arch, defines };
}

function cliDefines(def?: string[]): string[] {
  return (def ?? []).flatMap(d => d.split(",")).filter(Boolean);
}

function gitProtocol(explicit?: string): string {
  return explicit ?? process.env.SHARD_GIT_PROTOCOL ?? "https";
}

function inspect(absPath: string): Module {
  const module = new Module(absPath, basename(absPath), loadManifest(absPath, context("unknown", [])));
  scan(module);
  return module;
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("shard")
    .description("C build manager for shard modules")
    .version(pkg.version);

  program
    .command("build")
    .description("Build a shard module")
    .argument("[path]", "Path to the module (default: current directory)", ".")
    .option("--ignore-cache <mode>", "0=cache on (default), 1=ignore root cache, 2=ignore all cache")
    .option("--start", "Build and run the executable")
    .option("--def <names...>", "Pass defines and enable ?define:X conditionals (e.g. --def NODEBUG,VERSION=5)")
    .addOption(new Option("--profile <name>", "Compilation profile (overrides manifest)").choices([...PROFILE_NAMES]))
    .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
    .action(act(async (pkgPath: string, opts?: BuildOptions) => {
      console.log();
      const absPath = resolve(pkgPath);
      const mode = opts?.ignoreCache !== undefined ? parseInt(opts.ignoreCache, 10) : 0;
      if (Number.isNaN(mode) || mode < 0 || mode > 2) {
        throw new ShardError("usage", "--ignore-cache must be 0, 1, or 2");
      }

      const defines = cliDefines(opts?.def);
      const toolchain = createClangToolchain();
      const graph = await new Resolver(absPath, {
        compiler: toolchain.name,
        defines,
        gitProtocol: gitProtocol(opts?.gitProtocol),
        progress: createProgressSink(),
      }).resolve();

      for (const module of graph.topoOrder()) materialize(module);

      const standards = resolveStandards(graph);
      checkCompatibility(graph, standards);

      await new Builder(toolchain, absPath, {
        ignoreCache: mode,
        extraDefines: defines,
        profile: opts?.profile,
      }).build(graph, standards);

      if (opts?.start) {
        const exe = executablePath(graph.root, absPath, toolchain);
        if (!exe) throw new ShardError("usage", `"${basename(absPath)}" is not an executable module`);
        const proc = spawnSync(exe, [], { stdio: "inherit" });
        if (proc.error) throw proc.error;
        process.exit(proc.status ?? 0);
      }

      console.log("\n " + chalk.bgGreen.black.bold(" BUILD SUCCEEDED "));
      console.log();
    }));

  program
    .command("info")
    .description("Show module information")
    .argument("<path>", "Path to the module")
    .action(act((pkgPath: string) => {
      const module = inspect(resolve(pkgPath));
      const deps = parseDependencies(module.declaredDeps);
      console.log(`\n  Name: ${module.manifest.name ?? module.name}`);
      console.log(`  Type: ${module.shape}`);
      console.log(`  Include: ${privateIncludes(module.path, module.manifest, module.content!)[0] ?? "(none)"}`);
      if (deps.length) {
        console.log(`  Dependencies (${deps.length}):`);
        for (const dep of deps) console.log(`    - ${describeDependency(dep)}`);
      } else {
        console.log(`  Dependencies: none`);
      }
    }));

  program
    .command("update")
    .description("Sync modules/ with dependency declarations (install, remove stale, no compilation)")
    .argument("[path]", "Path to the root module (default: current directory)", ".")
    .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
    .action(act(async (pkgPath: string, opts?: { gitProtocol?: string }) => {
      const absPath = resolve(pkgPath);
      const toolchain = createClangToolchain();
      const graph = await new Resolver(absPath, {
        compiler: toolchain.name,
        defines: [],
        gitProtocol: gitProtocol(opts?.gitProtocol),
        progress: createProgressSink(),
      }).resolve();
      removeStale(absPath, graph.topoOrder().map(m => m.path));
      console.log(chalk.dim("Modules synced —") + " dependency modules up to date");
    }));

  program
    .command("clean")
    .description("Remove all build cache and installed dependencies")
    .argument("[path]", "Path to the root module (default: current directory)", ".")
    .action(act((pkgPath: string) => {
      const absPath = resolve(pkgPath);
      const manifest = loadManifest(absPath, context("unknown", []));
      runHook(absPath, manifest.scripts, "preclean");
      for (const dir of [join(absPath, DIRS.SHARD), join(absPath, DIRS.MODULES), join(absPath, DIRS.TARGET)]) {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
          console.log(`  removed: ${dir}`);
        }
      }
    }));

  program
    .command("run")
    .description("Run a script from the module manifest")
    .argument("<script>", "Script name from shard.json scripts field")
    .argument("[path]", "Path to the module (default: current directory)", ".")
    .action(act((script: string, pkgPath: string) => {
      const absPath = resolve(pkgPath);
      const manifest = loadManifest(absPath, context("unknown", []));
      requireScript(absPath, manifest.scripts, script);
    }));

  program
    .command("doctor")
    .description("Check availability of required toolchain tools")
    .action(() => runDoctor());

  return program;
}

function removeStale(rootPath: string, activePaths: string[]): void {
  const modulesDir = join(rootPath, DIRS.MODULES);
  if (!existsSync(modulesDir)) return;

  const active = new Set(activePaths);
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(modulesDir, entry.name);
    const isActive = active.has(full) || activePaths.some(p => p.startsWith(full + sep));
    if (!isActive) rmSync(full, { recursive: true, force: true });
  }
}
