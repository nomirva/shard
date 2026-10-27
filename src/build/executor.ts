import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { ShardError } from "../core/errors";
import type { CompileCache } from "../cache/cache";
import type { TargetGraph } from "../target/graph";
import type { Workspace } from "../workspace/workspace";
import { copyExports } from "./exports";
import type { CompileUnit, PlannedTarget } from "./plan";
import type { Runner } from "./runner";

/** Runs a build plan target by target in dependency order. */
export class Executor {
  constructor(
    private readonly ws: Workspace,
    private readonly runner: Runner,
    private readonly cache: CompileCache,
  ) {}

  async execute(graph: TargetGraph<PlannedTarget>): Promise<void> {
    try {
      for (const target of graph.topoOrder()) await this.buildTarget(target);
    } finally {
      this.cache.save();
    }
  }

  private async buildTarget(target: PlannedTarget): Promise<void> {
    const { build, layout } = target;
    this.ws.hooks.run(target, "prebuild");

    if (build.requireDir && !existsSync(build.requireDir)) {
      throw new ShardError(
        "build",
        `Invalid prebuilt package "${target.name}": expected libraries at "${build.requireDir}"`,
        "check the module layout or exports field",
      );
    }

    for (const unit of build.compile) await this.compile(unit, build.useCache);

    for (const step of build.link) {
      mkdirSync(step.dir, { recursive: true });
      if ("error" in step) throw step.error;
      await this.runner.run(step.invocation);
    }

    if (build.ship) {
      for (const lib of build.ship.libs) {
        if (lib.ifExists && !existsSync(lib.path)) continue;
        copyFileSync(lib.path, join(build.ship.toDir, lib.path.split("/").pop()!));
      }
    }

    copyExports(target.content.exports, layout.includeDir);
    this.ws.hooks.run(target, "postbuild");
  }

  private async compile(unit: CompileUnit, useCache: boolean): Promise<void> {
    const { reporter } = this.ws;
    if (useCache && this.cache.isFresh(unit.cacheKey, unit.task)) {
      reporter.compile("cached", unit.label);
      return;
    }

    mkdirSync(dirname(unit.task.object), { recursive: true });
    try {
      await this.runner.run(unit.invocation);
      reporter.compile("compiled", unit.label);
    } catch (err) {
      reporter.compile("failed", unit.label);
      throw err;
    }
    if (useCache) this.cache.record(unit.cacheKey, unit.task);
  }
}
