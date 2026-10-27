import { copyFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { Task, type TaskContext } from "../../core";
import { fingerprint } from "./fingerprint";
import { commandLine, type Runner } from "./runner";
import type { LinkKind, ReportEvent } from "../../report/events";
import type { CompileOptions, Toolchain } from "./toolchain/toolchain";
import { ShardError } from "../../utils/errors";
import { relativeTo } from "../../utils/fs";
import { countDiagnostics } from "../../utils/text";

abstract class ToolTask extends Task {
  toolchain!: Toolchain;
  runner!: Runner;
  readonly toolchainId = this.input<string>("toolchain");
  label = "";
}

export function objectPath(moduleDir: string, objectDir: string, source: string): string {
  return join(objectDir, relativeTo(moduleDir, source).replace(/\.c$/, ".o"));
}

export class CCompile extends ToolTask {
  readonly sources = this.inputFiles("sources");
  readonly options = this.input<Omit<CompileOptions, "includePaths">>("options");
  readonly includeDirs = this.inputList<string>("includeDirs");
  readonly objectDir = this.input<string>("objectDir");
  readonly incremental = this.input<boolean>("incremental").convention(true);
  readonly objects = this.outputFiles("objects");

  units(): { file: string; object: string; command: string; unit: { source: string; object: string; options: CompileOptions } }[] {
    const options = { includePaths: this.includeDirs.get(), ...this.options.get() };
    return this.sources.get().map(source => {
      const object = objectPath(this.moduleDir, this.objectDir.get(), source);
      const unit = { source, object, options };
      return { file: relativeTo(this.moduleDir, source), object, unit, command: commandLine(this.toolchain.compiler.compile(unit, this.moduleDir)) };
    });
  }

  async run(ctx: TaskContext): Promise<void> {
    const incremental = this.incremental.get();
    const units = this.units();
    let done = 0;
    for (const { file, object, unit, command } of units) {
      ctx.progress(done, units.length, file);
      const base = { target: this.label, file, command };

      if (incremental && ctx.state.get(file) === fingerprint(unit, this.toolchain.deps)) {
        report(ctx, { type: "compile", ...base, status: "cached", duration: 0, diagnostics: "" });
      } else {
        mkdirSync(dirname(object), { recursive: true });
        report(ctx, { type: "compile.start", target: this.label, file });
        const startedAt = performance.now();
        try {
          const diagnostics = await this.runner.run(this.toolchain.compiler.compile(unit, this.moduleDir));
          report(ctx, { type: "compile", ...base, status: "compiled", duration: performance.now() - startedAt, diagnostics });
        } catch (err) {
          const diagnostics = err instanceof ShardError ? err.output ?? "" : "";
          report(ctx, { type: "compile", ...base, status: "failed", duration: performance.now() - startedAt, diagnostics });
          if (!(err instanceof ShardError) || err.code !== "build") throw err;
          const errors = countDiagnostics(diagnostics, "error");
          throw new ShardError("build", errors > 0
            ? `${this.label}: ${errors} error${errors === 1 ? "" : "s"}`
            : `${this.label}: compilation failed (${err.message})`);
        }
        if (incremental) ctx.state.set(file, fingerprint(unit, this.toolchain.deps));
      }
      ctx.discovered(this.toolchain.deps.dependencies(object));
      ctx.progress(++done, units.length);
    }
  }
}

export class CArchive extends ToolTask {
  readonly objects = this.inputFiles("objects");
  readonly file = this.outputFile("file");

  async run(ctx: TaskContext): Promise<void> {
    mkdirSync(dirname(this.file.get()), { recursive: true });
    await runLink(this, ctx, this.toolchain.linker.archive({ objects: this.objects.get(), output: this.file.get() }), "static");
  }
}

export interface RuntimeLib {
  readonly path: string;
  readonly ifExists: boolean;
}

export class CLink extends ToolTask {
  readonly kind = this.input<"executable" | "shared">("kind");
  readonly objects = this.inputFiles("objects");
  readonly libFiles = this.inputFiles("libFiles");
  readonly libFlags = this.inputList<string>("libFlags");
  readonly extra = this.input<{ subsystem?: string; extra?: string[] }>("extra").convention({});
  readonly runtime = this.inputList<RuntimeLib>("runtime");
  readonly unsupported = this.input<string>("unsupported");
  readonly file = this.outputFile("file");

  async run(ctx: TaskContext): Promise<void> {
    const output = this.file.get();
    mkdirSync(dirname(output), { recursive: true });
    if (this.unsupported.isPresent()) {
      throw new ShardError("build", this.unsupported.get(), "request static linking or use a supported platform");
    }
    const { subsystem, extra } = this.extra.get();
    const invocation = this.toolchain.linker.link({
      kind: this.kind.get(),
      objects: this.objects.get(),
      output,
      libPaths: this.libFiles.get(),
      libFlags: this.libFlags.get(),
      subsystem: subsystem as never,
      extra,
    });
    await runLink(this, ctx, invocation, this.kind.get());

    if (this.kind.get() === "executable") {
      for (const lib of this.runtime.get()) {
        if (lib.ifExists && !existsSync(lib.path)) continue;
        copyFileSync(lib.path, join(dirname(output), basename(lib.path)));
      }
    }
  }
}

export class CopyHeaders extends Task {
  readonly entries = this.input<{ source: string; dest: string }[]>("entries");
  readonly sources = this.inputFiles("sources");
  readonly files = this.outputFiles("files");

  run(): void {
    for (const { source, dest } of this.entries.get()) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
    }
  }
}

function report(ctx: TaskContext, event: ReportEvent): void {
  ctx.report(event);
}

async function runLink(task: ToolTask, ctx: TaskContext, invocation: Parameters<Runner["run"]>[0], kind: LinkKind): Promise<void> {
  const startedAt = performance.now();
  try {
    await task.runner.run(invocation);
  } catch (err) {
    if (!(err instanceof ShardError) || err.code !== "build") throw err;
    throw new ShardError("build", `Linking failed: ${task.label} (${kind})`, undefined, {
      details: [["output", output(task)], ["error", err.message]],
      output: err.output,
    });
  }
  report(ctx, {
    type: "link", target: task.label, kind, output: output(task), duration: performance.now() - startedAt, command: commandLine(invocation),
  });
}

function output(task: ToolTask): string {
  return task instanceof CArchive || task instanceof CLink ? task.file.get() : "";
}
