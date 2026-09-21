import { ShardError } from "./errors";
import { shellSync } from "./process";

export function runHook(
  cwd: string,
  scripts: Record<string, string>,
  name: string,
): void {
  const command = scripts[name];
  if (command === undefined) return;
  execute(cwd, command, name, "pipe");
}

export function requireScript(
  cwd: string,
  scripts: Record<string, string>,
  name: string,
): void {
  const command = scripts[name];
  if (command === undefined) {
    throw new ShardError("config", `Script "${name}" is not defined in shard.json`);
  }
  execute(cwd, command, name, "inherit");
}

function execute(cwd: string, command: string, name: string, stdio: "pipe" | "inherit"): void {
  const result = shellSync(cwd, command, stdio);
  if (result.status !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new ShardError(
      "script",
      `Script "${name}" failed (exit code ${result.status})`,
      detail || `working directory: ${cwd}`,
    );
  }
}
