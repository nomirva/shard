import { ShardError } from "../utils/errors";
import type { Producer } from "./provider";
import type { Task } from "./task";
import type { TaskProvider } from "./tasks";

export interface GraphNode {
  readonly task: Task;
  /** Tasks that must succeed first. */
  readonly dependencies: readonly string[];
  /** Tasks this one finalizes: it runs after them once they ran, even if they failed. */
  readonly finalizes: readonly string[];
}

/**
 * The tasks needed for a request, in execution order. Building it creates
 * only the reachable tasks, then freezes their properties: from here on the
 * graph is plain data that does not change while it runs.
 */
export class TaskGraph {
  private constructor(
    private readonly nodes: ReadonlyMap<string, GraphNode>,
    private readonly order: readonly string[],
  ) {}

  static build(requested: readonly Producer[], lookup: (path: string) => TaskProvider<Task> | undefined): TaskGraph {
    const resolve = (p: Producer): Task => {
      const provider = lookup(p.path);
      if (!provider) throw new ShardError("config", `Task "${p.path}" is not registered`);
      return provider.get();
    };

    const nodes = new Map<string, { task: Task; dependencies: string[]; finalizes: string[] }>();
    const pending = requested.map(resolve);
    while (pending.length > 0) {
      const task = pending.pop()!;
      if (nodes.has(task.path)) continue;
      const dependencies = task.dependencies().map(p => p.path);
      nodes.set(task.path, { task, dependencies, finalizes: [] });
      for (const path of dependencies) pending.push(resolve({ path }));
      for (const finalizer of task.finalizedByTasks()) pending.push(resolve(finalizer));
    }
    for (const node of nodes.values()) {
      for (const finalizer of node.task.finalizedByTasks()) nodes.get(finalizer.path)!.finalizes.push(node.task.path);
    }

    const order = topoSort(nodes);
    for (const path of order) nodes.get(path)!.task.finalizeProperties();
    return new TaskGraph(nodes, order);
  }

  /** Dependencies before dependents; finalizers after what they finalize. */
  tasks(): Task[] {
    return this.order.map(path => this.nodes.get(path)!.task);
  }

  node(path: string): GraphNode {
    return this.nodes.get(path)!;
  }

  has(path: string): boolean {
    return this.nodes.has(path);
  }

  /** `--print-graph`: one line per task with what it waits for. */
  describe(): string[] {
    return this.order.map(path => {
      const { dependencies, finalizes } = this.nodes.get(path)!;
      const after = [...dependencies, ...finalizes.map(f => `finalizes ${f}`)];
      return after.length > 0 ? `${path} ← ${after.join(", ")}` : path;
    });
  }
}

function topoSort(nodes: ReadonlyMap<string, { dependencies: string[]; finalizes: string[] }>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (path: string): void => {
    const seen = state.get(path);
    if (seen === "done") return;
    if (seen === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(path)), path];
      throw new ShardError("config", "Task dependency cycle", undefined, { details: [["cycle", cycle.join(" → ")]] });
    }
    state.set(path, "visiting");
    stack.push(path);
    const node = nodes.get(path)!;
    for (const dep of [...node.dependencies, ...node.finalizes]) visit(dep);
    stack.pop();
    state.set(path, "done");
    order.push(path);
  };

  for (const path of [...nodes.keys()].sort()) visit(path);
  return order;
}
