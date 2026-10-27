import { ShardError } from "../core/errors";
import { shellSync } from "../core/process";
import type { DeclaredTarget } from "../target/target";

/** Reserved script names run by the pipeline itself. */
export type HookName = "preload" | "prebuild" | "postbuild" | "preclean";

export class HookRunner {
  /** Runs the hook if the target declares it; output is shown only on failure. */
  run(target: DeclaredTarget, hook: HookName): void {
    const command = target.manifest.scripts[hook];
    if (command === undefined) return;
    execute(target.path, command, hook, "pipe");
  }

  /** Runs a user script (`shard run`) with inherited output. */
  runScript(target: DeclaredTarget, name: string): void {
    const command = target.manifest.scripts[name];
    if (command === undefined) {
      throw new ShardError("config", `Script "${name}" is not defined in shard.json`);
    }
    execute(target.path, command, name, "inherit");
  }
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
