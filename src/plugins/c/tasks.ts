import { copyFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { Task, type TaskContext } from "../../core";
import { fingerprint } from "../../cache/fingerprint";
import type { Runner } from "../../build/runner";
import type { CompileOptions, Toolchain } from "../../toolchain/toolchain";
import { ShardError } from "../../utils/errors";
import { relativeTo } from "../../utils/fs";
import { countDiagnostics } from "../../utils/text";

/** Toolchain and runner are build services: set at configuration, not fingerprinted beyond `toolchainId`. */
abstract class ToolTask extends Task {
  toolchain!: Toolchain;
  runner!: Runner;
  /** Name and version: a different compiler invalidates the outputs. */
  readonly toolchainId = this.input<string>("toolchain");
  /** Module name for messages. */
  label = "";
}

/** The object file of `source` under `objectDir`, mirroring its path in the module. */
export function objectPath(moduleDir: string, objectDir: string, source: string): string {
  return join(objectDir, relativeTo(moduleDir, source).replace(/\.c$/, ".o"));
}

/**
 * Compiles every source of a module. Incremental inside: a file whose source,
 * options and headers did not change since its last compile is skipped.
 */
export class CCompile extends ToolTask {
  readonly sources = this.inputFiles("sources");
  readonly options = this.input<Omit<CompileOptions, "includePaths">>("options");
  readonly includeDirs = this.inputList<string>("includeDirs");
  readonly objectDir = this.input<string>("objectDir");
  readonly incremental = this.input<boolean>("incremental").convention(true);
  readonly objects = this.outputFiles("objects");

  async run(ctx: TaskContext): Promise<void> {
    const sources = this.sources.get();
    const options = { includePaths: this.includeDirs.get(), ...this.options.get() };
    const incremental = this.incremental.get();
    let done = 0;
    for (const source of sources) {
      const rel = relativeTo(this.moduleDir, source);
      const object = objectPath(this.moduleDir, this.objectDir.get(), source);
      const unit = { source, object, options };
      ctx.progress(done, sources.length, rel);

      if (!incremental || ctx.state.get(rel) !== fingerprint(unit, this.toolchain.deps)) {
        mkdirSync(dirname(object), { recursive: true });
        try {
          await this.runner.run(this.toolchain.compiler.compile(unit, this.moduleDir));
        } catch (err) {
          if (!(err instanceof ShardError) || err.code !== "build") throw err;
          const errors = countDiagnostics(err.output ?? "", "error");
          throw new ShardError("build", errors > 0
            ? `${this.label}: ${errors} error${errors === 1 ? "" : "s"}`
            : `${this.label}: compilation failed (${err.message})`, undefined, { output: err.output });
        }
        if (incremental) ctx.state.set(rel, fingerprint(unit, this.toolchain.deps));
      }
      ctx.discovered(this.toolchain.deps.dependencies(object));
      ctx.progress(++done, sources.length);
    }
  }
}

export class CArchive extends ToolTask {
  readonly objects = this.inputFiles("objects");
  readonly file = this.outputFile("file");

  async run(): Promise<void> {
    mkdirSync(dirname(this.file.get()), { recursive: true });
    await runLink(this, this.toolchain.linker.archive({ objects: this.objects.get(), output: this.file.get() }), "static");
  }
}

export interface RuntimeLib {
  readonly path: string;
  /** Copied only if it exists (a library the build may not have produced). */
  readonly ifExists: boolean;
}

/** Links an executable or a shared library; an executable also gets the shared libraries it needs next to it. */
export class CLink extends ToolTask {
  readonly kind = this.input<"executable" | "shared">("kind");
  readonly objects = this.inputFiles("objects");
  readonly libFiles = this.inputFiles("libFiles");
  readonly libFlags = this.inputList<string>("libFlags");
  readonly extra = this.input<{ subsystem?: string; extra?: string[] }>("extra").convention({});
  readonly runtime = this.inputList<RuntimeLib>("runtime");
  /** Set when the platform cannot produce this output. */
  readonly unsupported = this.input<string>("unsupported");
  readonly file = this.outputFile("file");

  async run(): Promise<void> {
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
    await runLink(this, invocation, this.kind.get());

    if (this.kind.get() === "executable") {
      for (const lib of this.runtime.get()) {
        if (lib.ifExists && !existsSync(lib.path)) continue;
        copyFileSync(lib.path, join(dirname(output), basename(lib.path)));
      }
    }
  }
}

/** Copies exported headers into the module's include directory. */
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

async function runLink(task: ToolTask, invocation: Parameters<Runner["run"]>[0], kind: string): Promise<void> {
  try {
    await task.runner.run(invocation);
  } catch (err) {
    if (!(err instanceof ShardError) || err.code !== "build") throw err;
    throw new ShardError("build", `Linking failed: ${task.label} (${kind})`, undefined, {
      details: [["output", task instanceof CArchive || task instanceof CLink ? task.file.get() : ""], ["error", err.message]],
      output: err.output,
    });
  }
}
