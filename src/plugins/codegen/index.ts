import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { extension, Task, type Configurable, type Module, type Plugin, type TaskContext } from "../../core";
import type { ReportEvent } from "../../report/events";
import { ShardError } from "../../utils/errors";
import { isPlainObject } from "../../utils/object";
import { shellSync } from "../../utils/process";
import { C } from "../c";

export interface CodegenBlock {
  command: string;
  inputs?: string[];
  outputs: string[];
}

export class Generate extends Task {
  readonly command = this.input<string>("command");
  readonly inputs = this.inputFiles("inputs");
  readonly outDir = this.input<string>("outDir");
  readonly files = this.outputFiles("files");
  label = "";

  run(ctx: TaskContext): void {
    const command = this.command.get();
    const report = (event: ReportEvent) => ctx.report(event);
    mkdirSync(this.outDir.get(), { recursive: true });
    report({ type: "hook.start", target: this.label, hook: "codegen", command });
    const startedAt = performance.now();
    const result = shellSync(this.moduleDir, command, "pipe", { SHARD_GEN_DIR: this.outDir.get() });
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    if (result.status !== 0) {
      throw new ShardError("script", `Generator failed (exit code ${result.status})`, undefined, {
        details: [["module", this.label], ["command", command], ["cwd", this.moduleDir]],
        output: output || undefined,
      });
    }
    const missing = this.files.get().filter(f => !existsSync(f));
    if (missing.length > 0) {
      throw new ShardError("script", `Generator did not write ${missing.length === 1 ? "a declared output" : "declared outputs"}`, undefined, {
        details: [["module", this.label], ["missing", missing.join(", ")]],
      });
    }
    report({ type: "hook", target: this.label, hook: "codegen", command, duration: performance.now() - startedAt, output });
  }
}

class CodegenExtension implements Configurable {
  constructor(private readonly module: Module) {}

  configure(raw: unknown): void {
    const block = raw as CodegenBlock;
    if (!isPlainObject(raw) || typeof block.command !== "string" || !Array.isArray(block.outputs)) {
      throw new ShardError("config", "The codegen block needs a command and its outputs");
    }
    const module = this.module;
    const outDir = join(module.buildDir, "generated");
    const task = module.tasks.register("generate", Generate, t => {
      t.label = module.name;
      t.command.set(block.command);
      t.inputs.addAll((block.inputs ?? []).map(f => join(module.dir, f)));
      t.outDir.set(outDir);
      t.files.addAll(block.outputs.map(f => join(outDir, f)));
      t.description = block.command;
    });
    module.plugins.withId("c", () => {
      module.extensions.get(C).generated.addAll(task.flatMap(t => t.files));
    });
  }
}

export const CODEGEN = extension<CodegenExtension>("codegen");

export function codegenPlugin(): Plugin {
  return {
    id: "codegen",
    apply(module) {
      module.extensions.add(CODEGEN, new CodegenExtension(module));
    },
  };
}
