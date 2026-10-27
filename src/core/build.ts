import { ShardError } from "../utils/errors";
import { AttributeSchema } from "./attributes";
import { execute, type ExecuteOptions, type ExecutionResult } from "./executor";
import { TaskGraph } from "./graph";
import { Module, type ModuleInit } from "./module";
import type { ResolutionServices } from "./resolution";
import type { Task } from "./task";
import type { TaskProvider } from "./tasks";

/**
 * One invocation of shard: every module taking part and every task they
 * registered. Initialization creates modules and applies plugins,
 * configuration builds the graph for the request, execution runs it.
 */
export class Build {
  /** Attribute matching rules; plugins define the attributes they introduce. */
  readonly schema = new AttributeSchema();
  private readonly modules = new Map<string, Module>();
  private readonly registry = new Map<string, TaskProvider<Task>>();
  private readonly resolution: ResolutionServices = {
    schema: this.schema,
    variantsOf: path => this.modules.get(path)?.configurations.consumableVariants(),
  };

  addModule(init: ModuleInit): Module {
    if (this.modules.has(init.path)) throw new ShardError("config", `Module ${init.path} already exists`);
    const module = new Module(init, {
      onRegister: task => this.registry.set(task.path, task),
      resolution: this.resolution,
    });
    this.modules.set(init.path, module);
    return module;
  }

  get root(): Module {
    const root = this.modules.get(":");
    if (!root) throw new ShardError("config", "Build has no root module");
    return root;
  }

  module(path: string): Module | undefined {
    return this.modules.get(path);
  }

  /** "assemble" names a task of the root module, ":lib:assemble" a task anywhere. */
  graph(requested: readonly string[]): TaskGraph {
    const providers = requested.map(request =>
      request.startsWith(":") ? this.lookup(request) : this.root.tasks.named(request));
    return TaskGraph.build(providers, path => this.registry.get(path));
  }

  async run(requested: readonly string[], options: ExecuteOptions): Promise<ExecutionResult> {
    return execute(this.graph(requested), options);
  }

  private lookup(path: string): TaskProvider<Task> {
    const task = this.registry.get(path);
    if (!task) throw new ShardError("config", `Task "${path}" not found`);
    return task;
  }
}
