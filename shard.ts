#!/usr/bin/env bun
import { Command } from "commander";
import { basename, resolve } from "path";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { Project } from "./src/project";
import { ClangToolchain } from "./src/clang";
import { reportError } from "./src/errors";
import type { ProgressSink } from "./src/dependency";
import pkg from "./package.json" with { type: "json" };

const program = new Command();

const progressSink: ProgressSink = (() => {
  let drew = false;
  let lastPct = -1;

  const label = (v: { name: string; version: string | null }): string =>
    v.version ? `${v.name} ${v.version}` : v.name;
  const pct = (p: number): string => (p > 0 ? ` [${p}%]` : " …");

  return {
    line(v): void {
      const line = `(${v.index}/${v.total}) ${label(v)}${pct(v.percent)}`;
      if (process.stderr.isTTY) {
        drew = true;
        process.stderr.write(`\r\x1b[2K${line}`);
        return;
      }
      if (!drew || (v.percent > 0 && v.percent - lastPct >= 5)) {
        drew = true;
        lastPct = v.percent;
        process.stderr.write(`${line}\n`);
      }
    },
    end(): void {
      if (drew && process.stderr.isTTY) process.stderr.write("\n");
      drew = false;
    },
  };
})();

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
  .action(act(async (pkgPath: string, opts?: { ignoreCache?: string; start?: boolean; def?: string[]; gitProtocol?: string }) => {
    console.log();
    const absPath = resolve(pkgPath);
    const mode = opts?.ignoreCache !== undefined ? parseInt(opts.ignoreCache, 10) : 0;
    if (mode < 0 || mode > 2) {
      throw new Error("--ignore-cache must be 0, 1, or 2");
    }

    const project = new Project(absPath, {
      ignoreCache: mode,
      defines: (opts?.def ?? []).flatMap((d: string) => d.split(",")).filter(Boolean),
      gitProtocol: opts?.gitProtocol,
      progress: progressSink,
    });
    await project.build();

    if (opts?.start) {
      const exe = project.executablePath();
      if (!exe) {
        throw new Error(`"${basename(absPath)}" is not an executable module`);
      }
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
    const absPath = resolve(pkgPath);
    const project = new Project(absPath);
    project.info();
  }));

program
  .command("update")
  .description("Sync modules/ with dependency declarations (install, remove stale, no compilation)")
  .argument("[path]", "Path to the root module (default: current directory)", ".")
  .option("--git-protocol <protocol>", "Git protocol: https (default), ssh, or http")
  .action(act(async (pkgPath: string, opts?: { gitProtocol?: string }) => {
    const absPath = resolve(pkgPath);
    const project = new Project(absPath, { gitProtocol: opts?.gitProtocol, progress: progressSink });
    await project.update();
    console.log(chalk.dim("Modules synced —") + " " + "dependency modules up to date");
  }));

program
  .command("clean")
  .description("Remove all build cache and installed dependencies")
  .argument("[path]", "Path to the root module (default: current directory)", ".")
  .action(act((pkgPath: string) => {
    const absPath = resolve(pkgPath);
    const project = new Project(absPath);
    project.cleanAll();
  }));

program
  .command("run")
  .description("Run a script from the module manifest")
  .argument("<script>", "Script name from shard.json scripts field")
  .argument("[path]", "Path to the module (default: current directory)", ".")
  .action(act((script: string, pkgPath: string) => {
    const absPath = resolve(pkgPath);
    const project = new Project(absPath);
    project.runScript(script);
  }));

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
