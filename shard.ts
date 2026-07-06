#!/usr/bin/env bun
import { Command } from "commander";
import { resolve, basename, join } from "path";
import { existsSync, rmSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { setupToolchain } from "./src/toolchain/detect";
import { Module } from "./src/module";
import { PackageShape } from "./src/types";
import { ClangToolchain } from "./src/toolchain/clang";

const program = new Command();

program
  .name("shard")
  .description("C build manager for shard modules")
  .version("1.0.0");

program
  .command("build")
  .description("Build a shard module")
  .argument("[path]", "Path to the module (default: current directory)", ".")
      .option("--ignore-cache <mode>", "0=cache on (default), 1=ignore root cache, 2=ignore all cache")
      .option("--run", "Build and run the executable")
      .option("--def <names...>", "Pass defines and enable $define:X conditionals (e.g. --def NODEBUG,VERSION=5)")
      .action(async (pkgPath: string, opts?: { ignoreCache?: string; run?: boolean; def?: string[] }) => {
    try {
      console.log();
      const absPath = resolve(pkgPath);
      const mode = opts?.ignoreCache !== undefined ? parseInt(opts.ignoreCache, 10) : 0;
      if (mode < 0 || mode > 2) {
        throw new Error("--ignore-cache must be 0, 1, or 2");
      }

      Module.ignoreCache = mode;
      Module.extraDefines = (opts?.def ?? []).flatMap((d: string) => d.split(',')).filter(Boolean);
      const tc = setupToolchain();
      const root = new Module(absPath, tc);
      root.load();
      await root.update();
      await root.build();

      const r = root.result!;

      if (opts?.run) {
        if (r.type !== "executable" || !r.executablePath) {
          throw new Error(`"${basename(absPath)}" is not an executable module`);
        }
        const proc = spawnSync(r.executablePath, [], { stdio: "inherit" });
        if (proc.error) throw proc.error;
        process.exit(proc.status ?? 0);
      }

      console.log("\n " + chalk.bgGreen.black.bold(" BUILD SUCCEEDED "));
      console.log();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(` Error: ${message}`));
      console.log("\n " + chalk.bgRed.black.bold(" BUILD FAILED "));
      console.log();
      process.exit(1);
    }
  });

program
  .command("info")
  .description("Show module information")
  .argument("<path>", "Path to the module")
  .action((pkgPath: string) => {
    try {
      const absPath = resolve(pkgPath);
      const mod = new Module(absPath);
      mod.load();
      mod.info();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Sync modules/ with dependency declarations (install, remove stale, no compilation)")
  .argument("[path]", "Path to the root module (default: current directory)", ".")
  .action(async (pkgPath: string) => {
    try {
      const absPath = resolve(pkgPath);
      const root = new Module(absPath);
      root.load();
      await root.update();
      const count = root.deps.filter(d => d.module !== null).length;
      console.log(chalk.dim("Modules synced —") + " " + `${count} dependency module(s)`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command("clean")
  .description("Remove all build cache and installed dependencies")
  .argument("[path]", "Path to the root module (default: current directory)", ".")
  .action((pkgPath: string) => {
    try {
      const absPath = resolve(pkgPath);
      const shardDir = join(absPath, ".shard");
      const modulesDir = join(absPath, "modules");
      const targetDir = join(absPath, "target");
      const srcDir = join(absPath, "src");

      for (const d of [shardDir, modulesDir]) {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
          console.log(chalk.dim("  removed:") + " " + d);
        }
      }

      if (existsSync(targetDir) && existsSync(srcDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        console.log(chalk.dim("  removed:") + " " + targetDir);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command("run")
  .description("Run a built executable")
  .argument("[path]", "Path to the module (default: current directory)", ".")
  .option("--variant <name>", "Select a build variant")
  .action((pkgPath: string, opts?: { variant?: string }) => {
    try {
      const absPath = resolve(pkgPath);
      const mod = new Module(absPath);
      mod.load();

      if (mod.type !== PackageShape.Executable) {
        throw new Error(`"${mod.name}" is not an executable module`);
      }

      const tc = setupToolchain();
      const baseDir = join(absPath, "target", tc.targetDir);
      const variant = opts?.variant;
      const subdir = variant ? join(baseDir, variant) : baseDir;
      const exePath = join(subdir, `${mod.name}${tc.exeExt}`);

      if (existsSync(exePath)) {
        const proc = spawnSync(exePath, [], { stdio: "inherit" });
        if (proc.error) throw proc.error;
        process.exit(proc.status ?? 0);
      }

      if (variant) {
        throw new Error(`Variant "${variant}" not found or not built`);
      }

      if (existsSync(baseDir)) {
        const entries = readdirSync(baseDir, { withFileTypes: true });
        const variants = entries
          .filter(e => e.isDirectory() && existsSync(join(baseDir, e.name, `${mod.name}${tc.exeExt}`)))
          .map(e => e.name);

        if (variants.length > 0) {
          console.log(chalk.yellow("Available variants:"));
          for (const v of variants) console.log(`  ${v}`);
          console.log(chalk.dim("\nUse --variant <name> to select one."));
          process.exit(1);
        }
      }

      throw new Error(`Executable not found: ${exePath}\nBuild it first: shard build`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Check availability of required toolchain tools")
  .action(() => {
    interface CheckResult {
      name: string;
      ok: boolean;
      version: string;
      error?: string;
    }

    const compilers: CheckResult[] = [];
    const tools: { section: string; results: CheckResult[] }[] = [
      { section: "[Toolchain]", results: compilers },
    ];

    const clang = new ClangToolchain();
    compilers.push(
      clang.detect()
        ? { name: clang.name, ok: true, version: clang.version }
        : { name: clang.name, ok: false, version: "not found", error: "not found" }
    );

    {
      const r = spawnSync("git", ["--version"], { stdio: "pipe" });
      const gitCheck: CheckResult = r.status !== 0
        ? { name: "git", ok: false, version: "not found", error: "not found" }
        : { name: "git", ok: true, version: (r.stdout?.toString() ?? "").trim() };
      tools.push({ section: "[Version Control]", results: [gitCheck] });
    }

    for (const section of tools) {
      console.log(`\n ${chalk.bold(section.section)}`);
      for (const r of section.results) {
        const name = r.name.padEnd(6);
        if (r.ok) {
          console.log(` ${name}${r.version}`);
        } else {
          console.log(` ${name}${chalk.red("✗")} ${r.error}`);
        }
      }
    }

    const allChecks = tools.flatMap(s => s.results);
    const allOk = allChecks.every(r => r.ok);
    if (allOk) {
      console.log("\n " + chalk.bgGreen.black.bold(" READY TO USE "));
    } else {
      console.log("\n " + chalk.bgRed.black.bold(" NOT READY TO USE "));
      process.exit(1);
    }
    console.log();
  });

program.parse();
