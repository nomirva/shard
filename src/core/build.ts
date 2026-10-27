import { ShardError } from "../utils/errors";
import { AttributeSchema } from "./attributes";
import { execute, type ExecuteOptions, type ExecutionResult } from "./executor";
import { TaskGraph } from "./graph";
import { Module, type ModuleInit } from "./module";
import type { ResolutionServices } from "./resolution";
import { ServiceRegistry } from "./services";
import type { Task } from "./task";
import type { TaskProvider } from "./tasks";

export class Build {
  readonly schema = new AttributeSchema();
  readonly services = new ServiceRegistry();
  private readonly modules = new Map<string, Module>();
  private readonly order: Module[] = [];
  private readonly warningListeners: ((module: Module, message: string) => void)[] = [];
  private readonly reportListeners: ((module: Module, event: unknown) => void)[] = [];
  private configured = false;
  private readonly registry = new Map<string, TaskProvider<Task>>();
  private readonly resolution: ResolutionServices = {
    schema: this.schema,
    variantsOf: path => this.modules.get(path)?.configurations.consumableVariants(),
    edgeRequests: path => [...this.modules.values()].flatMap(m => m.configurations.all())
      .filter(c => c.role === "scope")
      .flatMap(c => c.declaredDependencies())
      .flatMap(d => (d.kind === "module" && d.path === path ? [d.attributes] : [])),
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
      report: (module, event) => this.reportListeners.forEach(l => l(module, event)),
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

  onReport(listener: (module: Module, event: unknown) => void): void {
    this.reportListeners.push(listener);
  }

  markInitialized(module: Module): void {
    if (!this.order.includes(module)) this.order.push(module);
  }

  configure(): void {
    if (this.configured) return;
    this.configured = true;
    const rest = [...this.modules.values()].filter(m => !this.order.includes(m));
    for (const module of [...this.order, ...rest]) module.runConfigured();
  }

  graph(requested: readonly string[]): TaskGraph {
    const providers = requested.map(request =>
      request.startsWith(":") ? this.lookup(request) : this.root.tasks.named(request));
    const rank = new Map<string, number>();
    for (const m of [...this.order, ...this.modules.values()]) if (!rank.has(m.path)) rank.set(m.path, rank.size);
    return TaskGraph.build(providers, path => this.registry.get(path), task => rank.get(task.modulePath) ?? 0);
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
