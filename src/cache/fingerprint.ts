import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import type { CompileTask, DependencyTracker } from "../toolchain/toolchain";

/** Source bytes + compile options + every header the toolchain reports for the object. */
export function fingerprint(task: CompileTask, tracker: DependencyTracker): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(task.source));
  hash.update(JSON.stringify(task.options));
  for (const dep of tracker.dependencies(task.object)) {
    if (existsSync(dep)) hash.update(readFileSync(dep));
  }
  return hash.digest("hex");
}
