import { ShardError } from "../../utils/errors";
import { runAsync, runSync } from "../../utils/process";
import type { Invocation } from "./toolchain/toolchain";

/** Executes invocations described by the toolchain; the seam for parallel or dry-run execution. */
export interface Runner {
  /** Resolves with the tool's diagnostics; rejects with a ShardError carrying them as `output`. */
  run(invocation: Invocation): Promise<string>;
}

export const processRunner: Runner = {
  async run(inv: Invocation): Promise<string> {
    if (inv.io === "stream") return runAsync(inv.tool, [...inv.args], { cwd: inv.cwd });

    const r = runSync(inv.tool, [...inv.args], inv.cwd);
    const output = (r.stderr || r.stdout).trim();
    if (r.status !== 0) {
      throw new ShardError("build", `${inv.tool} failed (exit code ${r.status})`, undefined, { output });
    }
    return output;
  },
};

export function commandLine(inv: Invocation): string {
  return [inv.tool, ...inv.args].join(" ");
}
