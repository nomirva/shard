import { spawn, spawnSync } from "child_process";
import { ShardError } from "./errors";

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
  const r = spawnSync(command, [], { stdio, shell: true, cwd });
  if (r.error) throw new ShardError("script", `Failed to run "${command}": ${r.error.message}`);
  return {
    status: r.status ?? -1,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
}
