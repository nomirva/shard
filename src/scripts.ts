import { spawnSync } from "child_process";
import { ShardError } from "./errors";

export function runHook(
  cwd: string,
  scripts: Record<string, string> | undefined,
  name: string,
): void {
  const cmd = scripts?.[name];
  if (cmd === undefined) return;
  quiet(cwd, cmd, name);
}

export function requireScript(
  cwd: string,
  scripts: Record<string, string> | undefined,
  name: string,
): void {
  const cmd = scripts?.[name];
  if (cmd === undefined) {
    throw new ShardError("config", `Script "${name}" is not defined in shard.json`);
  }
  interactive(cwd, cmd, name);
}

function quiet(cwd: string, command: string, name: string): void {
  const r = spawnSync(command, [], { stdio: "pipe", shell: true, cwd });
  if (r.status !== 0) {
    const out = (r.stdout?.toString() ?? "").trim();
    const err = (r.stderr?.toString() ?? "").trim();
    const detail = [err, out].filter(Boolean).join("\n");
    throw new ShardError(
      "script",
      `Script "${name}" failed (exit code ${r.status ?? "?"})`,
      detail || `working directory: ${cwd}`,
    );
  }
}

function interactive(cwd: string, command: string, name: string): void {
  const r = spawnSync(command, [], { stdio: "inherit", shell: true, cwd });
  if (r.status !== 0) {
    throw new ShardError(
      "script",
      `Script "${name}" failed (exit code ${r.status ?? "?"})`,
      `working directory: ${cwd}`,
    );
  }
}
