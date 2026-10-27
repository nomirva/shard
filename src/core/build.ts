import { ShardError } from "../utils/errors";
import { AttributeSchema } from "./attributes";
import { execute, type ExecuteOptions, type ExecutionResult } from "./executor";
import { TaskGraph } from "./graph";
import { Module, type ModuleInit } from "./module";
import type { ResolutionServices } from "./resolution";
import { ServiceRegistry } from "./services";
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
  readonly services = new ServiceRegistry();
  private readonly modules = new Map<string, Module>();
  /** Dependencies before dependents, as initialization finished them. */
  private readonly order: Module[] = [];
  private readonly warningListeners: ((module: Module, message: string) => void)[] = [];
  private configured = false;
  private readonly registry = new Map<string, TaskProvider<Task>>();
  private readonly resolution: ResolutionServices = {
    schema: this.schema,
    variantsOf: path => this.modules.get(path)?.configurations.consumableVariants(),
  };

  constructor(readonly rootDir: string) {}

  addModule(init: ModuleInit): Module {
    if (this.modules.has(init.path)) throw new ShardError("config", `Module ${init.path} already exists`);
    const module = new Module(init, {
      onRegister: task => this.registry.set(task.path, task),
      resolution: this.resolution,
      services: this.services,
      rootDir: this.rootDir,
      warn: (module, message) => this.warningListeners.forEach(l => l(module, message)),
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

  allModules(): Module[] {
    return [...this.modules.values()];
  }

  onWarning(listener: (module: Module, message: string) => void): void {
    this.warningListeners.push(listener);
  }

  /** Initialization reports each module once its dependencies are done. */
  markInitialized(module: Module): void {
    if (!this.order.includes(module)) this.order.push(module);
  }

  /** Ends configuration: runs `onConfigured` actions, dependencies first. Idempotent. */
  configure(): void {
    if (this.configured) return;
    this.configured = true;
    const rest = [...this.modules.values()].filter(m => !this.order.includes(m));
    for (const module of [...this.order, ...rest]) module.runConfigured();
  }

  /** "assemble" names a task of the root module, ":lib:assemble" a task anywhere. */
  graph(requested: readonly string[]): TaskGraph {
    const providers = requested.map(request =>
      request.startsWith(":") ? this.lookup(request) : this.root.tasks.named(request));
    return TaskGraph.build(providers, path => this.registry.get(path));
  }

  async run(requested: readonly string[], options: ExecuteOptions): Promise<ExecutionResult> {
    this.configure();
    return execute(this.graph(requested), options);
  }

  private lookup(path: string): TaskProvider<Task> {
    const task = this.registry.get(path);
    if (!task) throw new ShardError("config", `Task "${path}" not found`);
    return task;
  }
}
