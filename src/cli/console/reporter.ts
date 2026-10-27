import chalk from "chalk";
import { viewError } from "../../utils/errors";
import type { CompileStatus, Reporter } from "../../report/reporter";
import { createProgressSink } from "./progress";

const MARKS: Record<CompileStatus, string> = {
  cached: chalk.dim("≡"),
  compiled: chalk.green("✔"),
  failed: chalk.red("✘"),
};

export function createConsoleReporter(): Reporter {
  return {
    progress: createProgressSink(),
    compile(status, label) {
      process.stderr.write(` ${MARKS[status]} ${label}\n`);
    },
    warn(message) {
      process.stderr.write(`Warning: ${message}\n`);
    },
  };
}

export function reportError(e: unknown): void {
  const { code, message, hint } = viewError(e);
  console.error();
  console.error(chalk.red(`  ✖ [${code}] ${message}`));
  if (hint) console.error(chalk.dim(`    hint: ${hint}`));
  console.error();
}

export function banner(text: string, ok: boolean): void {
  const style = ok ? chalk.bgGreen.black.bold : chalk.bgRed.black.bold;
  console.log("\n " + style(` ${text} `));
}
