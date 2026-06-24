#!/usr/bin/env bun
import { Command } from "commander";
import { resolve, basename, join } from "path";
import { existsSync, rmSync } from "fs";
import { spawnSync } from "child_process";
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
  .action(async (pkgPath: string, opts?: { ignoreCache?: string; run?: boolean }) => {
    try {
      const absPath = resolve(pkgPath);
      const mode = opts?.ignoreCache !== undefined ? parseInt(opts.ignoreCache, 10) : 0;
      if (mode < 0 || mode > 2) {
        throw new Error("--ignore-cache must be 0, 1, or 2");
      }

      Module.ignoreCache = mode;
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

      console.log(`Type: ${r.type}`);
      if (r.linkType) console.log(`Link: ${r.linkType}`);
      if (r.includePaths.length) console.log(`Include: ${r.includePaths[0]}`);
      for (let i = 1; i < r.includePaths.length; i++) console.log(`  ${r.includePaths[i]}`);
      if (r.libPaths.length) console.log(`Lib: ${r.libPaths[0]}`);
      for (let i = 1; i < r.libPaths.length; i++) console.log(`  ${r.libPaths[i]}`);
      if (r.executablePath) console.log(`Executable: ${r.executablePath}`);
      if (r.sharedLibs.length) {
        console.log("Shared libs:");
        for (const sl of r.sharedLibs) console.log(`  ${sl}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${message}`);
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
      console.error(`Error: ${message}`);
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
      console.log(`Modules synced — ${count} dependency module(s)`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${message}`);
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
          console.log(`  removed: ${d}`);
        }
      }

      if (existsSync(binDir)) {
        rmSync(binDir, { recursive: true, force: true });
        console.log(`  removed: ${binDir}`);
      }

      if (existsSync(libDir) && existsSync(srcDir)) {
        rmSync(libDir, { recursive: true, force: true });
        console.log(`  removed: ${libDir}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

program.parse();
