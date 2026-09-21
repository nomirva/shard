import { basename } from "path";
import { loadManifest, type ConditionalContext } from "../module/manifest";
import { Module } from "../module/module";
import { withProgress, type InstallProgress, type ProgressSink } from "../utils/progress";
import { ModuleGraph } from "../module/graph";
import { installDependency, parseDependency } from "./dependency";
import type { InstallEnvironment } from "./types";

export interface ResolveOptions {
  compiler: string;
  defines: string[];
  gitProtocol: string;
  progress?: ProgressSink;
}

export class Resolver {
  private readonly graph = new ModuleGraph();
  private readonly visited = new Set<Module>();
  private readonly env: InstallEnvironment;

  constructor(
    private readonly rootPath: string,
    private readonly options: ResolveOptions,
  ) {
    this.env = { rootPath, gitProtocol: options.gitProtocol };
  }

  async resolve(): Promise<ModuleGraph> {
    const root = this.createModule(this.rootPath, basename(this.rootPath));
    this.graph.setRoot(root);
    await this.resolveDeps(root);
    return this.graph;
  }

  private createModule(path: string, name: string): Module {
    const existing = this.graph.node(path);
    if (existing) return existing;
    return this.graph.addNode(new Module(path, name, loadManifest(path, this.context())));
  }

  private async resolveDeps(module: Module): Promise<void> {
    if (this.visited.has(module)) return;
    this.visited.add(module);

    const deps = module.declaredDeps;
    for (let i = 0; i < deps.length; i++) {
      const dep = parseDependency(deps[i]);
      const progress: InstallProgress = { name: dep.name, version: dep.version, percent: 0 };

      const result = await withProgress(
        this.options.progress,
        { name: dep.name, version: dep.version, index: i + 1, total: deps.length },
        progress,
        () => installDependency(dep, {
          ...this.env,
          onProgress: (percent) => { progress.percent = percent; },
        }),
      );

      if (result.kind === "module") {
        const child = this.createModule(result.path, result.name);
        this.graph.connect(module, child, dep.link);
        await this.resolveDeps(child);
      } else {
        this.graph.addFlags(module, result.flags);
      }
    }
  }

  private context(): ConditionalContext {
    return {
      compiler: this.options.compiler,
      platform: process.platform,
      arch: process.arch,
      defines: this.options.defines,
    };
  }
}
