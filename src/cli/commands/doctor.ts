import { spawnSync } from "child_process";
import chalk from "chalk";
import { listToolchains } from "../../toolchain/registry";
import { pad, shortVersion } from "../console/format";

interface CheckResult {
  name: string;
  version: string | null;
  path: string | null;
  hint?: string;
}

export function doctorCommand(): void {
  const toolchains = listToolchains().map((provider): CheckResult => {
    const tc = provider.detect();
    return {
      name: provider.name,
      version: tc ? shortVersion(tc.version) : null,
      path: tc ? Bun.which(provider.name) : null,
      hint: provider.installHint,
    };
  });

  const git = spawnSync("git", ["--version"], { stdio: "pipe" });
  const gitCheck: CheckResult = {
    name: "git",
    version: git.status === 0 ? shortVersion(git.stdout?.toString() ?? "") : null,
    path: git.status === 0 ? Bun.which("git") : null,
    hint: "https://git-scm.com/downloads",
  };

  const sections = [
    { title: "Toolchain", results: toolchains },
    { title: "Version control", results: [gitCheck] },
  ];
  const width = Math.max(...sections.flatMap(s => s.results.map(r => r.name.length)));
  const lines: string[] = [];

  for (const section of sections) {
    lines.push("", ` ${chalk.bold(section.title)}`);
    for (const check of section.results) {
      const name = pad(check.name, width);
      if (check.version) {
        lines.push(`   ${chalk.green("✓")} ${name}  ${check.version}  ${chalk.dim(check.path ?? "")}`);
      } else {
        lines.push(`   ${chalk.red("✗")} ${name}  ${chalk.red("not found")}`);
        if (check.hint) lines.push(`     ${chalk.dim("install: " + check.hint)}`);
      }
    }
  }

  // Ready when at least one toolchain and git are available.
  const ready = toolchains.some(r => r.version) && gitCheck.version !== null;
  lines.push("", ready ? ` ${chalk.green("✔")} ${chalk.bold("Ready to use")}` : ` ${chalk.red("✘")} ${chalk.bold("Not ready to use")}`, "");
  console.log(lines.join("\n"));
  if (!ready) process.exit(1);
}
