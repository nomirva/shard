import { ShardError } from "../utils/errors";
import { shellSync } from "../utils/process";
import type { Reporter } from "../report/reporter";
import type { DeclaredTarget } from "../target/target";

/** Reserved script names run by the pipeline itself. */
export type HookName = "preload" | "prebuild" | "postbuild" | "preclean";

const OUTPUT_TAIL_LINES = 20;

export class HookRunner {
  constructor(private readonly reporter: Reporter) {}

  /** Runs the hook if the target declares it; output is captured and reported. */
  run(target: DeclaredTarget, hook: HookName): void {
    const command = target.manifest.scripts[hook];
    if (command === undefined) return;

    this.reporter.emit({ type: "hook.start", target: target.name, hook, command });
    const startedAt = performance.now();
    const result = shellSync(target.path, command, "pipe");
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    if (result.status !== 0) throw scriptError(target, hook, command, result.status, output);

    this.reporter.emit({
      type: "hook",
      target: target.name,
      hook,
      command,
      duration: performance.now() - startedAt,
      output,
    });
  }

  /** Runs a user script (`shard run`) with inherited output. */
  runScript(target: DeclaredTarget, name: string): void {
    const command = target.manifest.scripts[name];
    if (command === undefined) {
      throw new ShardError("config", `Script "${name}" is not defined in shard.json`, undefined, {
        details: [["module", target.name], ["available", Object.keys(target.manifest.scripts).join(", ") || "(none)"]],
      });
    }
    const result = shellSync(target.path, command, "inherit");
    if (result.status !== 0) throw scriptError(target, name, command, result.status, "");
  }
}

function scriptError(target: DeclaredTarget, name: string, command: string, status: number, output: string): ShardError {
  return new ShardError("script", `Script "${name}" failed (exit code ${status})`, undefined, {
    details: [["module", target.name], ["command", command], ["cwd", target.path]],
    output: output.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n") || undefined,
  });
}
