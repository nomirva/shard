import type { LinkInput } from "../toolchain/toolchain";
import { withProgress, type InstallProgress } from "../report/progress";
import type { Workspace } from "../workspace/workspace";
import { TargetGraph, type GraphBuilder } from "../target/graph";
import type { DeclaredTarget, ResolvedTarget } from "../target/target";
import { parseDependency } from "./parse";
import { sourceFor } from "./registry";
import type { ResolveEnv } from "./source";
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

  constructor(private readonly ws: Workspace) {
    this.store = new ModuleStore(ws.modulesDir);
  }

  async resolve(root: DeclaredTarget): Promise<TargetGraph<ResolvedTarget>> {
    await this.visit(this.graph.setRoot(root));
    return this.graph.build().map(target => ({ ...target, linkFlags: this.flags.get(target.path) ?? [] }));
  }

  private async visit(target: DeclaredTarget): Promise<void> {
    if (this.visited.has(target.path)) return;
    this.visited.add(target.path);

    const deps = target.manifest.depend;
    for (let i = 0; i < deps.length; i++) {
      const dep = parseDependency(deps[i]);
      const progress: InstallProgress = { name: dep.name, version: dep.version, percent: 0 };
      const env: ResolveEnv = {
        rootPath: this.ws.rootPath,
        store: this.store,
        gitProtocol: this.ws.settings.resolve.gitProtocol,
        onProgress: (percent) => { progress.percent = percent; },
      };

      const decision = await withProgress(
        this.ws.reporter.progress,
        { name: dep.name, version: dep.version, index: i + 1, total: deps.length },
        progress,
        async () => {
          const decision = sourceFor(dep.kind)!.decide(dep, env);
          if (decision.kind === "link") this.addLinkFlags(target, decision.inputs);
          else await decision.install?.();
          return decision;
        },
      );

      if (decision.kind === "module") {
        const child = this.graph.get(decision.path) ?? this.graph.add(this.ws.declare(decision.path, decision.name));
        this.graph.connect(target, child, dep.link);
        await this.visit(child);
      }
    }
  }

  private addLinkFlags(target: DeclaredTarget, inputs: readonly LinkInput[]): void {
    const own = this.flags.get(target.path) ?? [];
    for (const input of inputs) {
      const { flags, warnings } = this.ws.toolchain.linkInputs.translate(input);
      for (const warning of warnings) this.ws.reporter.warn(warning);
      own.push(...flags);
    }
    this.flags.set(target.path, own);
  }
}
