import { existsSync } from "fs";
import type { CacheStore } from "./store";
import type { TaskGraph } from "./graph";
import { fingerprintTask, outputPaths } from "./fingerprint";
import type { Task, TaskContext } from "./task";

export type TaskOutcome =
  | { kind: "executed" }
  | { kind: "up-to-date" }
  | { kind: "failed"; error: unknown }
  /** A dependency failed, so the task never started. */
  | { kind: "skipped" };

/** What the executor reports; the CLI turns these into progress rows. */
export interface ExecutionListener {
  taskStart?(task: Task): void;
  taskProgress?(task: Task, done: number, total: number, current?: string): void;
  /** What a running task passed to `ctx.report`. */
  taskReport?(task: Task, event: unknown): void;
  taskEnd?(task: Task, outcome: TaskOutcome, duration: number): void;
}

export interface ExecuteOptions {
  /** How many tasks may run at once. */
  readonly jobs: number;
  readonly cache: CacheStore;
  readonly listener?: ExecutionListener;
  readonly now?: () => number;
}

export interface ExecutionResult {
  readonly outcomes: ReadonlyMap<string, TaskOutcome>;
  /** Errors of failed tasks in the order they failed. */
  readonly failures: readonly unknown[];
}

interface CacheRecord {
  readonly hash: string;
  readonly discovered: string[];
}

/**
 * Runs the graph: a task starts once all its dependencies succeeded, up to
 * `jobs` at a time. After a failure no new tasks start, except finalizers of
 * tasks that ran. A task is up to date when its fingerprint matches the last
 * successful run and all its outputs exist.
 */
export async function execute(graph: TaskGraph, options: ExecuteOptions): Promise<ExecutionResult> {
  const now = options.now ?? (() => performance.now());
  const tasks = graph.tasks();
  const outcomes = new Map<string, TaskOutcome>();
  const failures: unknown[] = [];
  const running = new Map<string, Promise<void>>();

  const succeeded = (path: string): boolean => {
    const kind = outcomes.get(path)?.kind;
    return kind === "executed" || kind === "up-to-date";
  };
  const ran = (path: string): boolean => {
    const kind = outcomes.get(path)?.kind;
    return kind === "executed" || kind === "failed";
  };

  /** "run" when ready, "wait" while something it needs is unfinished, "skip" when it can never run. */
  const readiness = (task: Task): "run" | "wait" | "skip" => {
    const node = graph.node(task.path);
    for (const dep of node.dependencies) {
      if (!outcomes.has(dep)) return "wait";
      if (!succeeded(dep)) return "skip";
    }
    if (node.finalizes.length > 0) {
      if (node.finalizes.some(path => !outcomes.has(path))) return "wait";
      if (task.finalizeOnSuccessOnly) return node.finalizes.every(succeeded) ? "run" : "skip";
      return node.finalizes.some(ran) ? "run" : "skip";
    }
    return failures.length > 0 ? "skip" : "run";
  };

  const start = (task: Task): void => {
    const begin = now();
    options.listener?.taskStart?.(task);
    const promise = runTask(task, options)
      .then(kind => {
        outcomes.set(task.path, { kind });
        options.listener?.taskEnd?.(task, { kind }, now() - begin);
      })
      .catch(error => {
        failures.push(error);
        outcomes.set(task.path, { kind: "failed", error });
        options.listener?.taskEnd?.(task, { kind: "failed", error }, now() - begin);
      })
      .finally(() => running.delete(task.path));
    running.set(task.path, promise);
  };

  for (;;) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (outcomes.has(task.path) || running.has(task.path)) continue;
        const state = readiness(task);
        if (state === "skip") {
          outcomes.set(task.path, { kind: "skipped" });
          options.listener?.taskEnd?.(task, { kind: "skipped" }, 0);
          changed = true;
        } else if (state === "run" && running.size < options.jobs) {
          start(task);
          changed = true;
        }
      }
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  options.cache.flush();
  return { outcomes, failures };
}

async function runTask(task: Task, options: ExecuteOptions): Promise<"executed" | "up-to-date"> {
  const key = `task:${task.path}`;
  const outputs = outputPaths(task);
  const tracked = !task.alwaysRun && outputs.length > 0;
  const previous = tracked ? readRecord(options.cache.get(key)) : null;

  if (previous && fingerprintTask(task, previous.discovered) === previous.hash && outputs.every(p => existsSync(p))) {
    return "up-to-date";
  }

  const discovered: string[] = [];
  const ctx: TaskContext = {
    discovered: files => { for (const f of files) if (!discovered.includes(f)) discovered.push(f); },
    progress: (done, total, current) => options.listener?.taskProgress?.(task, done, total, current),
    report: event => options.listener?.taskReport?.(task, event),
    state: {
      get: k => options.cache.get(`state:${task.path}:${k}`),
      set: (k, v) => options.cache.set(`state:${task.path}:${k}`, v),
    },
  };
  try {
    await task.run(ctx);
  } catch (error) {
    // Outputs of a failed run may be partial: never trust them as up to date.
    if (tracked) options.cache.set(key, "");
    throw error;
  }

  if (tracked) {
    const record: CacheRecord = { hash: fingerprintTask(task, discovered), discovered };
    options.cache.set(key, JSON.stringify(record));
  }
  return "executed";
}

function readRecord(raw: string | undefined): CacheRecord | null {
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as CacheRecord;
    return typeof parsed.hash === "string" && Array.isArray(parsed.discovered) ? parsed : null;
  } catch {
    return null;
  }
}
