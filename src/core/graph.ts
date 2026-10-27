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

  /**
   * `rank` orders independent tasks: lower first. The build ranks a task by
   * its module's place in dependency order, so with one job modules build
   * one after another, dependencies first.
   */
  static build(
    requested: readonly Producer[],
    lookup: (path: string) => TaskProvider<Task> | undefined,
    rank: (task: Task) => number = () => 0,
  ): TaskGraph {
    const resolve = (p: Producer): Task => {
      const provider = lookup(p.path);
      if (!provider) throw new ShardError("config", `Task "${p.path}" is not registered`);
      return provider.get();
    };

    // Depth-first in declaration order, dependencies first: the order independent tasks keep.
    const nodes = new Map<string, { task: Task; dependencies: string[]; finalizes: string[] }>();
    const visiting = new Set<string>();
    const visit = (task: Task): void => {
      if (nodes.has(task.path) || visiting.has(task.path)) return;
      visiting.add(task.path);
      const dependencies = task.dependencies().map(p => p.path);
      for (const path of dependencies) visit(resolve({ path }));
      visiting.delete(task.path);
      nodes.set(task.path, { task, dependencies, finalizes: [] });
      for (const finalizer of task.finalizedByTasks()) visit(resolve(finalizer));
    };
    requested.map(resolve).forEach(visit);
    for (const node of nodes.values()) {
      for (const finalizer of node.task.finalizedByTasks()) nodes.get(finalizer.path)!.finalizes.push(node.task.path);
    }

    checkCycles(nodes);
    const order = prioritized(nodes, rank);
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

interface Edges {
  readonly task: Task;
  readonly dependencies: string[];
  readonly finalizes: string[];
}

/** Kahn's algorithm: of the tasks whose predecessors are placed, the lowest rank goes next, then discovery order. */
function prioritized(nodes: ReadonlyMap<string, Edges>, rank: (task: Task) => number): string[] {
  const paths = [...nodes.keys()];
  const index = new Map(paths.map((p, i) => [p, i]));
  const before = (p: string) => [...nodes.get(p)!.dependencies, ...nodes.get(p)!.finalizes];
  const waiting = new Map(paths.map(p => [p, new Set(before(p))]));
  const after = new Map<string, string[]>(paths.map(p => [p, []]));
  for (const p of paths) for (const q of before(p)) after.get(q)!.push(p);

  const key = (p: string): [number, number] => [rank(nodes.get(p)!.task), index.get(p)!];
  const ready = paths.filter(p => waiting.get(p)!.size === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    const next = ready.shift()!;
    order.push(next);
    for (const p of after.get(next)!) {
      const w = waiting.get(p)!;
      w.delete(next);
      if (w.size === 0) ready.push(p);
    }
  }
  return order;
}

function checkCycles(nodes: ReadonlyMap<string, { dependencies: string[]; finalizes: string[] }>): void {
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
  };

  for (const path of [...nodes.keys()].sort()) visit(path);
}
