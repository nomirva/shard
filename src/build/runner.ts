import { ShardError } from "../utils/errors";
import { runAsync, runSync } from "../utils/process";
import type { Invocation } from "../toolchain/toolchain";

/** Executes invocations described by the toolchain; the seam for parallel or dry-run execution. */
export interface Runner {
  run(invocation: Invocation): Promise<void>;
}

export const processRunner: Runner = {
  async run(inv: Invocation): Promise<void> {
    if (inv.io === "stream") {
      await runAsync(inv.tool, [...inv.args], { cwd: inv.cwd });
      return;
    }
    const r = runSync(inv.tool, [...inv.args], inv.cwd);
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      throw new ShardError("build", `${inv.tool} failed (exit code ${r.status})`, msg || undefined);
    }
  },
};
