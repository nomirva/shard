#!/usr/bin/env bun
import { Command } from "commander";
import { resolve, basename, join } from "path";
import { existsSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { setupToolchain } from "./src/toolchain/detect";
import { Module } from "./src/module";
import { ClangToolchain } from "./src/toolchain/clang";
import { Fetcher } from "./src/fetcher";
import pkg from "./package.json" with { type: "json" };

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
      .option("--def <names...>", "Pass defines and enable $define:X conditionals (e.g. --def NODEBUG,VERSION=5)")
      .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
      .action(async (pkgPath: string, opts?: { ignoreCache?: string; start?: boolean; def?: string[]; gitProtocol?: string }) => {
    try {
      console.log();
      const absPath = resolve(pkgPath);
      const mode = opts?.ignoreCache !== undefined ? parseInt(opts.ignoreCache, 10) : 0;
      if (mode < 0 || mode > 2) {
        throw new Error("--ignore-cache must be 0, 1, or 2");
      }

      Module.ignoreCache = mode;
      Module.extraDefines = (opts?.def ?? []).flatMap((d: string) => d.split(',')).filter(Boolean);
      if (opts?.gitProtocol) {
        Fetcher.gitProtocol = opts.gitProtocol;
      } else if (process.env.SHARD_GIT_PROTOCOL) {
        Fetcher.gitProtocol = process.env.SHARD_GIT_PROTOCOL;
      }
      const tc = setupToolchain();
      const root = new Module(absPath, tc);
      root.load();
      await root.update();
      await root.build();

      const r = root.result!;

      if (opts?.start) {
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

      const mod = new Module(absPath);
      mod.load();
      const preclean = mod.manifest.scripts?.preclean;
      if (preclean) {
        const r = spawnSync(preclean, [], { stdio: "inherit", shell: true, cwd: absPath });
        if (r.status !== 0) throw new Error("preclean hook failed");
      }

      const shardDir = join(absPath, ".shard");
      const modulesDir = join(absPath, "modules");
      const targetDir = join(absPath, "target");

      for (const d of [shardDir, modulesDir]) {
        if (existsSync(d)) {
          rmSync(d, { recursive: true, force: true });
          console.log(chalk.dim("  removed:") + " " + d);
        }
      }

      if (existsSync(targetDir)) {
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
  .description("Run a script from the module manifest")
  .argument("<script>", "Script name from shard.json scripts field")
  .argument("[path]", "Path to the module (default: current directory)", ".")
  .action((script: string, pkgPath: string) => {
    try {
      const absPath = resolve(pkgPath);
      const mod = new Module(absPath);
      mod.load();
      mod.runScript(script);
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
