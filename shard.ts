#!/usr/bin/env bun
import { Command } from "commander";
import { resolve, basename, join } from "path";
import { existsSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { setupToolchain } from "./src/toolchain/detect";
import { Module } from "./src/module";

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

      console.log(chalk.dim("Type:") + " " + r.type);
      if (r.linkType) console.log(chalk.dim("Link:") + " " + r.linkType);
      if (r.includePaths.length) console.log(chalk.dim("Include:") + " " + r.includePaths[0]);
      for (let i = 1; i < r.includePaths.length; i++) console.log(`  ${r.includePaths[i]}`);
      if (r.libPaths.length) console.log(chalk.dim("Lib:") + " " + r.libPaths[0]);
      for (let i = 1; i < r.libPaths.length; i++) console.log(`  ${r.libPaths[i]}`);
      if (r.executablePath) console.log(chalk.dim("Executable:") + " " + r.executablePath);
      if (r.sharedLibs.length) {
        console.log(chalk.dim("Shared libs:"));
        for (const sl of r.sharedLibs) console.log(`  ${sl}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
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
      const libDir = join(absPath, "lib");
      const binDir = join(absPath, "bin");
      const srcDir = join(absPath, "src");

      for (const d of [shardDir, modulesDir]) {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
          console.log(chalk.dim("  removed:") + " " + d);
        }
      }

      if (existsSync(binDir)) {
        rmSync(binDir, { recursive: true, force: true });
        console.log(chalk.dim("  removed:") + " " + binDir);
      }

      if (existsSync(libDir) && existsSync(srcDir)) {
        rmSync(libDir, { recursive: true, force: true });
        console.log(chalk.dim("  removed:") + " " + libDir);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program.parse();
