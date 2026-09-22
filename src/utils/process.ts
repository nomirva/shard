import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { ShardError } from "./errors";

function posixShell(): string | null {
  if (process.platform !== "win32") return "sh";
  const candidates = [
    process.env.SHELL,
    "C:\\Program Files\\Git\\bin\\sh.exe",
    "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
    "C:\\Program Files (x86)\\Git\\bin\\sh.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe",
  ].filter((p): p is string => !!p && existsSync(p));
  if (candidates.length > 0) return candidates[0];
  const probe = spawnSync("where", ["sh"], { stdio: "pipe" });
  const found = probe.status === 0 ? (probe.stdout?.toString() ?? "").split(/\r?\n/)[0]?.trim() : "";
  return found || null;
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runSync(cmd: string, args: string[], cwd?: string): RunResult {
  const r = spawnSync(cmd, args, { stdio: "pipe", cwd });
  if (r.error) throw new ShardError("toolchain", `Failed to run "${cmd}": ${r.error.message}`);
  return {
    status: r.status ?? -1,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
}

export function runAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = opts.env ?? { ...process.env, CLICOLOR_FORCE: "1", TERM: "xterm-256color" };
    const proc = spawn(cmd, args, { stdio: ["inherit", "pipe", "inherit"], cwd: opts.cwd, env });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new ShardError("build", `${cmd} failed (exit code ${code ?? "?"})`));
    });
    proc.on("error", (e: Error) =>
      reject(new ShardError("toolchain", `Failed to run "${cmd}": ${e.message}`)),
    );
  });
}

export function shellSync(cwd: string, command: string, stdio: "pipe" | "inherit"): RunResult {
  const shell = posixShell();
  const r = shell
    ? spawnSync(shell, ["-c", command], { stdio, cwd })
    : spawnSync(command, [], { stdio, shell: true, cwd });
  if (r.error) throw new ShardError("script", `Failed to run "${command}": ${r.error.message}`);
  return {
    status: r.status ?? -1,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
}
