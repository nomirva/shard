import { join } from "path";
import { ShardError } from "../utils/errors";
import type { DepInfo } from "../report/events";
import type { LinkInput } from "../toolchain/toolchain";
import type { Workspace } from "../workspace/workspace";
import { TargetGraph, type GraphBuilder } from "../target/graph";
import type { DeclaredTarget, ResolvedTarget } from "../target/target";
import { parseDependency, sourceLabel } from "./parse";
import { sourceFor } from "./registry";
import type { Dependency, ResolveEnv } from "./source";
import { ModuleStore } from "./store";

/**
 * Walks `depend` declarations depth-first. The tree cannot be resolved ahead
 * of installation: a fetched module's own dependencies are known only once its
 * manifest is on disk, so decide → install → read manifest runs per edge.
 */
export class Resolver {
  private readonly graph: GraphBuilder<DeclaredTarget> = TargetGraph.builder();
  private readonly flags = new Map<string, string[]>();
  private readonly visited = new Set<string>();
  private readonly store: ModuleStore;
  private nextId = 0;

  constructor(private readonly ws: Workspace) {
    this.store = new ModuleStore(ws.modulesDir);
  }

  async resolve(root: DeclaredTarget): Promise<TargetGraph<ResolvedTarget>> {
    await this.visit(this.graph.setRoot(root), [root.name], null);
    this.ws.reporter.emit({ type: "resolve.end" });
    return this.graph.build().map(target => ({ ...target, linkFlags: this.flags.get(target.path) ?? [] }));
  }

  /**
   * `chain` lists module names from the root down to `target`; `via` is the
   * edge that reached it. All declared dependencies are announced up front.
   */
  private async visit(target: DeclaredTarget, chain: readonly string[], via: number | null): Promise<void> {
    if (this.visited.has(target.path)) return;
    this.visited.add(target.path);

    const { reporter } = this.ws;
    const deps = target.manifest.depend.map(spec => this.parse(spec, target));
    const infos = deps.map((dep): DepInfo => ({
      id: this.nextId++,
      parentId: via,
      name: dep.name,
      source: sourceLabel(dep),
      spec: sourceFor(dep.kind)!.spec(dep),
      link: dep.link,
    }));
    if (infos.length > 0) reporter.emit({ type: "deps.declared", parent: target.name, parentId: via, deps: infos });

    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      const info = infos[i];
      const source = sourceFor(dep.kind)!;
      const env: ResolveEnv = {
        rootPath: this.ws.rootPath,
        store: this.store,
        gitProtocol: this.ws.settings.resolve.gitProtocol,
        requestedBy: chain,
        onProgress: (percent) => reporter.emit({ type: "dep.progress", id: info.id, percent }),
      };

      reporter.emit({ type: "dep.start", id: info.id });
      const startedAt = performance.now();
      const decision = source.decide(dep, env);

      if (decision.kind === "link") {
        const { flags, warnings } = this.addLinkFlags(target, decision.inputs);
        reporter.emit({ type: "dep.done", dep: info, action: "linked", duration: performance.now() - startedAt, flags, warnings });
        continue;
      }

      const known = this.graph.get(decision.path);
      await decision.install?.();
      reporter.emit({
        type: "dep.done",
        dep: info,
        action: known ? "duplicate" : decision.action,
        duration: performance.now() - startedAt,
        previous: decision.previous,
        path: decision.path,
        warnings: [],
      });

      const child = known ?? this.graph.add(this.ws.declare(decision.path, decision.name));
      this.graph.connect(target, child, dep.link);
      await this.visit(child, [...chain, child.name], info.id);
    }
  }

  private parse(spec: string, target: DeclaredTarget): Dependency {
    try {
      return parseDependency(spec);
    } catch (err) {
      if (err instanceof ShardError) err.details.push(["declared in", join(target.path, "shard.json")]);
      throw err;
    }
  }

  private addLinkFlags(target: DeclaredTarget, inputs: readonly LinkInput[]): { flags: string[]; warnings: string[] } {
    const own = this.flags.get(target.path) ?? [];
    const added: string[] = [];
    const warnings: string[] = [];
    for (const input of inputs) {
      const translated = this.ws.toolchain.linkInputs.translate(input);
      added.push(...translated.flags);
      warnings.push(...translated.warnings);
    }
    own.push(...added);
    this.flags.set(target.path, own);
    return { flags: added, warnings };
  }
}
