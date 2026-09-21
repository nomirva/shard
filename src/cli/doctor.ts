import { spawnSync } from "child_process";
import chalk from "chalk";
import { ClangToolchain } from "../toolchain/clang";

interface CheckResult {
  name: string;
  ok: boolean;
  version: string;
  error?: string;
}

export function runDoctor(): void {
  const clang = new ClangToolchain();
  const clangCheck: CheckResult = clang.detect()
    ? { name: clang.name, ok: true, version: clang.version }
    : { name: clang.name, ok: false, version: "not found", error: "not found" };

  const git = spawnSync("git", ["--version"], { stdio: "pipe" });
  const gitCheck: CheckResult = git.status !== 0
    ? { name: "git", ok: false, version: "not found", error: "not found" }
    : { name: "git", ok: true, version: (git.stdout?.toString() ?? "").trim() };

  const sections = [
    { title: "[Toolchain]", results: [clangCheck] },
    { title: "[Version Control]", results: [gitCheck] },
  ];

  for (const section of sections) {
    console.log(`\n ${chalk.bold(section.title)}`);
    for (const check of section.results) {
      const name = check.name.padEnd(6);
      console.log(check.ok ? ` ${name}${check.version}` : ` ${name}${chalk.red("✗")} ${check.error}`);
    }
  }

  const allOk = sections.flatMap(s => s.results).every(r => r.ok);
  if (!allOk) {
    console.log("\n " + chalk.bgRed.black.bold(" NOT READY TO USE "));
    process.exit(1);
  }
  console.log("\n " + chalk.bgGreen.black.bold(" READY TO USE "));
  console.log();
}
