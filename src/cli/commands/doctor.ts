import { spawnSync } from "child_process";
import chalk from "chalk";
import { listToolchains } from "../../toolchain/registry";
import { banner } from "../console/reporter";

interface CheckResult {
  name: string;
  ok: boolean;
  version: string;
  error?: string;
}

export function doctorCommand(): void {
  const toolchainChecks = listToolchains().map((provider): CheckResult => {
    const tc = provider.detect();
    return tc
      ? { name: provider.name, ok: true, version: tc.version }
      : { name: provider.name, ok: false, version: "not found", error: "not found" };
  });

  const git = spawnSync("git", ["--version"], { stdio: "pipe" });
  const gitCheck: CheckResult = git.status !== 0
    ? { name: "git", ok: false, version: "not found", error: "not found" }
    : { name: "git", ok: true, version: (git.stdout?.toString() ?? "").trim() };

  const sections = [
    { title: "[Toolchain]", results: toolchainChecks },
    { title: "[Version Control]", results: [gitCheck] },
  ];

  for (const section of sections) {
    console.log(`\n ${chalk.bold(section.title)}`);
    for (const check of section.results) {
      const name = check.name.padEnd(6);
      console.log(check.ok ? ` ${name}${check.version}` : ` ${name}${chalk.red("✗")} ${check.error}`);
    }
  }

  // Ready when at least one toolchain and git are available.
  const allOk = toolchainChecks.some(r => r.ok) && gitCheck.ok;
  if (!allOk) {
    banner("NOT READY TO USE", false);
    process.exit(1);
  }
  banner("READY TO USE", true);
  console.log();
}
