import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { ShardError } from "../utils/errors";
import { DEFAULT_PROFILE } from "../lang/profiles";
import type { TargetSummary } from "../report/events";
import type { CompileCache } from "../cache/cache";
import type { TargetGraph } from "../target/graph";
import type { Workspace } from "../workspace/workspace";
import { copyExports } from "./exports";
import type { CompileUnit, LinkStep, PlannedTarget } from "./plan";
import { commandLine, type Runner } from "./runner";

/** Runs a build plan target by target in dependency order. */
export class Executor {
  constructor(
    private readonly ws: Workspace,
    private readonly runner: Runner,
    private readonly cache: CompileCache,
  ) {}

  async execute(graph: TargetGraph<PlannedTarget>): Promise<void> {
    const order = graph.topoOrder();
    this.ws.reporter.emit({ type: "build.start", targets: order.map(summarize) });
    try {
      for (const target of order) await this.buildTarget(target);
    } finally {
      this.cache.save();
    }
  }

  private async buildTarget(target: PlannedTarget): Promise<void> {
    const { build, layout } = target;
    const { reporter } = this.ws;
    const startedAt = performance.now();
    reporter.emit({ type: "target.start", target: summarize(target) });
    this.ws.hooks.run(target, "prebuild");

    if (build.requireDir && !existsSync(build.requireDir)) {
      throw new ShardError(
        "build",
        `Invalid prebuilt package "${target.name}": expected libraries at "${build.requireDir}"`,
        "check the module layout or exports field",
      );
    }

    for (const unit of build.compile) await this.compile(target, unit, build.useCache);
    for (const step of build.link) await this.link(target, step);

    if (build.ship) {
      for (const lib of build.ship.libs) {
        if (lib.ifExists && !existsSync(lib.path)) continue;
        copyFileSync(lib.path, join(build.ship.toDir, lib.path.split("/").pop()!));
      }
    }

    copyExports(target.content.exports, layout.includeDir);
    this.ws.hooks.run(target, "postbuild");
    reporter.emit({
      type: "target.end",
      target: target.name,
      duration: performance.now() - startedAt,
      outputs: build.link.map(step => step.output),
    });
  }

  private async compile(target: PlannedTarget, unit: CompileUnit, useCache: boolean): Promise<void> {
    const { reporter } = this.ws;
    const base = { target: target.name, file: unit.file, command: commandLine(unit.invocation) };
    if (useCache && this.cache.isFresh(unit.cacheKey, unit.task)) {
      reporter.emit({ type: "compile", ...base, status: "cached", duration: 0, diagnostics: "" });
      return;
    }

    mkdirSync(dirname(unit.task.object), { recursive: true });
    reporter.emit({ type: "compile.start", target: target.name, file: unit.file });
    const startedAt = performance.now();
    try {
      const diagnostics = await this.runner.run(unit.invocation);
      reporter.emit({ type: "compile", ...base, status: "compiled", duration: performance.now() - startedAt, diagnostics });
    } catch (err) {
      const diagnostics = err instanceof ShardError ? err.output ?? "" : "";
      reporter.emit({ type: "compile", ...base, status: "failed", duration: performance.now() - startedAt, diagnostics });
      if (!(err instanceof ShardError) || err.code !== "build") throw err;
      throw new ShardError("build", `Compilation failed: ${target.name}`, undefined, {
        details: [["file", unit.task.source]],
      });
    }
    if (useCache) this.cache.record(unit.cacheKey, unit.task);
  }

  private async link(target: PlannedTarget, step: LinkStep): Promise<void> {
    mkdirSync(step.dir, { recursive: true });
    if ("error" in step) throw step.error;

    const startedAt = performance.now();
    try {
      await this.runner.run(step.invocation);
    } catch (err) {
      if (!(err instanceof ShardError) || err.code !== "build") throw err;
      throw new ShardError("build", `Linking failed: ${target.name} (${step.kind})`, undefined, {
        details: [["output", step.output], ["error", err.message]],
        output: err.output,
      });
    }
    this.ws.reporter.emit({
      type: "link",
      target: target.name,
      kind: step.kind,
      output: step.output,
      duration: performance.now() - startedAt,
      command: commandLine(step.invocation),
    });
  }
}

function summarize(target: PlannedTarget): TargetSummary {
  const { compile } = target.settings;
  return {
    name: target.name,
    shape: target.shape,
    standard: compile.standard?.version,
    profile: compile.profile ?? DEFAULT_PROFILE,
    files: target.build.compile.length,
  };
}
