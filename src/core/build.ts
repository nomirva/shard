import { ShardError } from "../utils/errors";
import { AttributeSchema } from "./attributes";
import { execute, type ExecuteOptions, type ExecutionResult } from "./executor";
import { TaskGraph } from "./graph";
import { Project, type ProjectInit } from "./project";
import type { ResolutionServices } from "./resolution";
import type { Task } from "./task";
import type { TaskProvider } from "./tasks";

/**
 * One invocation of shard: every project taking part and every task they
 * registered. Initialization creates projects and applies plugins,
 * configuration builds the graph for the request, execution runs it.
 */
export class Build {
  /** Attribute matching rules; plugins define the attributes they introduce. */
  readonly schema = new AttributeSchema();
  private readonly projects = new Map<string, Project>();
  private readonly registry = new Map<string, TaskProvider<Task>>();
  private readonly resolution: ResolutionServices = {
    schema: this.schema,
    variantsOf: path => this.projects.get(path)?.configurations.consumableVariants(),
  };

  addProject(init: ProjectInit): Project {
    if (this.projects.has(init.path)) throw new ShardError("config", `Project ${init.path} already exists`);
    const project = new Project(init, {
      onRegister: task => this.registry.set(task.path, task),
      resolution: this.resolution,
    });
    this.projects.set(init.path, project);
    return project;
  }

  get root(): Project {
    const root = this.projects.get(":");
    if (!root) throw new ShardError("config", "Build has no root project");
    return root;
  }

  project(path: string): Project | undefined {
    return this.projects.get(path);
  }

  /** "assemble" names a task of the root project, ":lib:assemble" a task anywhere. */
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
