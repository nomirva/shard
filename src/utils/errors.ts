import chalk from "chalk";

export type ErrorCode =
  | "usage"
  | "config"
  | "toolchain"
  | "git"
  | "conflict"
  | "build"
  | "script"
  | "unknown";

export class ShardError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ShardError";
  }
}

interface ErrorView {
  code: ErrorCode;
  message: string;
  hint?: string;
}

export function viewError(e: unknown): ErrorView {
  if (e instanceof ShardError) return { code: e.code, message: e.message, hint: e.hint };
  if (e instanceof Error) return { code: "unknown", message: e.message };
  return { code: "unknown", message: String(e) };
}

export function reportError(e: unknown): void {
  const { code, message, hint } = viewError(e);
  console.error();
  console.error(chalk.red(`  ✖ [${code}] ${message}`));
  if (hint) console.error(chalk.dim(`    hint: ${hint}`));
  console.error();
}
