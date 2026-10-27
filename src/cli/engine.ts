import { existsSync } from "fs";
import { availableParallelism } from "os";
import { join, resolve } from "path";
import {
  Build, execute, initialize, scriptReader,
  type DeclaredEdge, type ExecutionListener, type InitListener, type Module, type Task, type TaskGraph,
} from "../core";
import { JsonCacheStore } from "../cache/store";
import { builtinPlugins, DEFAULT_PLUGINS, jsonReader } from "../plugins";
import { C_MODULES, C_PARAMETERS, C_TOOLCHAIN, CArchive, CCompile, CLink, type CModules, type CParameters } from "../plugins/c";
import { GIT_PARAMETERS } from "../plugins/git";
import type { DepAction, DepInfo, ReportEvent } from "../report/events";
import type { Reporter } from "../report/reporter";
import type { Toolchain } from "../toolchain/toolchain";
import { ShardError } from "../utils/errors";
import { DIRS } from "../workspace/layout";

export interface OpenOptions {
  readonly reporter: Reporter;
  /** Detected by the command up front (build, update); otherwise only if something needs it. */
  readonly toolchain?: Toolchain;
  readonly params?: Partial<CParameters>;
  readonly gitProtocol?: string;
  /** Load only the root module (run, clean). */
  readonly dependencies?: boolean;
  /** Resolve without fetching (info); failing edges go to `listener.failed`. */
  readonly dryRun?: boolean;
  /** Instead of reporting the resolve phase. */
  readonly listener?: InitListener;
}

export interface OpenBuild {
  readonly build: Build;
  readonly root: Module;
  readonly toolchain: Toolchain | null;
  readonly params: CParameters;
}

/** One command's build: services from flags, then initialization with the resolve phase reported. */
export async function openBuild(path: string, options: OpenOptions): Promise<OpenBuild> {
  const rootDir = resolve(path);
  if (!existsSync(rootDir)) throw new ShardError("usage", `Module directory not found: ${rootDir}`);

  const build = new Build(rootDir);
  const params: CParameters = { defines: [], cacheMode: 0, ...options.params };
  build.services.register(C_PARAMETERS, params);
  build.services.register(GIT_PARAMETERS, {
    protocol: options.gitProtocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https",
  });
  // Known before configs are read, so `?compiler:` conditionals and `compiler` in shard.ts see it.
  const toolchain = options.toolchain ? build.services.register(C_TOOLCHAIN, options.toolchain) : null;

  const { reporter } = options;
  build.onWarning((_module, message) => reporter.emit({ type: "warning", message }));
  build.onReport((_module, event) => reporter.emit(event as ReportEvent));

  const listener = options.listener ?? resolveEvents(reporter);
  const root = await initialize(build, {
    registry: builtinPlugins(),
    readers: [scriptReader, jsonReader],
    defaultPlugins: DEFAULT_PLUGINS,
    defines: params.defines,
    context: { compiler: toolchain?.name ?? "unknown" },
    listener,
    dryRun: options.dryRun,
    dependencies: options.dependencies,
  });
  if (!options.listener && options.dependencies !== false) reporter.emit({ type: "resolve.end" });
  return { build, root, toolchain, params };
}

/** The resolve phase as the console shows it: each module's dependencies, then each edge's outcome. */
export function resolveEvents(reporter: Reporter): InitListener {
  const depInfo = (edge: DeclaredEdge): DepInfo => ({
    id: edge.id,
    parentId: edge.parentId,
    name: edge.info.name,
    source: edge.info.source,
    spec: edge.info.spec,
    link: edge.info.link,
  });
  return {
    declared: (module, edges) => reporter.emit({
      type: "deps.declared", parent: module.name, parentId: edges[0]!.parentId, deps: edges.map(depInfo),
    }),
    start: edge => reporter.emit({ type: "dep.start", id: edge.id }),
    progress: (edge, percent) => reporter.emit({ type: "dep.progress", id: edge.id, percent }),
    done: (edge, result) => {
      const note = result.target.kind === "missing" ? undefined : result.target.note;
      const action = (result.duplicate ? "duplicate" : note?.action ?? "local") as DepAction;
      reporter.emit({
        type: "dep.done",
        dep: depInfo(edge),
        action,
        duration: result.duration,
        previous: note?.previous,
        path: result.dir,
        flags: note?.flags ? [...note.flags] : undefined,
        warnings: [...(note?.warnings ?? [])],
      });
    },
  };
}

export interface RunTasksOptions {
  readonly reporter: Reporter;
  readonly jobs?: number;
  /** Report the build phase (modules, files, links); off for `run` and `clean`. */
  readonly buildEvents?: boolean;
  /** End configuration first (runs `preload`); off for `run` and `clean`, which do not build. */
  readonly configure?: boolean;
}

/** How many tasks run at once: `--jobs`, then SHARD_JOBS, then one per CPU. */
export function jobCount(flag?: string): number {
  const raw = flag ?? process.env.SHARD_JOBS;
  if (raw === undefined) return availableParallelism();
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new ShardError("usage", "--jobs must be a positive number", undefined, { details: [["got", raw]] });
  }
  return n;
}

/** Ends configuration, builds the graph for `requested` and runs it; throws the first failure. */
export async function runTasks(open: OpenBuild, requested: readonly string[], options: RunTasksOptions): Promise<TaskGraph> {
  const { build } = open;
  if (options.configure !== false) build.configure();
  const graph = build.graph(requested);
  const listener = options.buildEvents === false
    ? { taskReport: (_task: Task, event: unknown) => options.reporter.emit(event as ReportEvent) }
    : buildEvents(open, graph, options.reporter);
  const { failures } = await execute(graph, {
    jobs: options.jobs ?? jobCount(),
    cache: new JsonCacheStore(join(build.rootDir, DIRS.SHARD)),
    listener,
  });
  if (failures.length > 0) throw failures[0];
  return graph;
}

/**
 * The build phase as the console shows it, from task events: a module starts
 * with its first task and ends when all its tasks in the graph succeeded.
 */
function buildEvents(open: OpenBuild, graph: TaskGraph, reporter: Reporter): ExecutionListener {
  const { build, params } = open;
  const modules = build.services.find(C_MODULES);
  const ordered = modules ? modules.topoOrder() : [];
  reporter.emit({
    type: "build.start",
    targets: ordered.map(m => modules!.summary(m, params.profile)),
    tree: modules ? modules.tree() : { name: open.root.name, repeat: false, children: [] },
  });

  const pending = new Map<string, Set<string>>();
  for (const task of graph.tasks()) {
    pending.set(task.modulePath, (pending.get(task.modulePath) ?? new Set()).add(task.path));
  }
  const started = new Map<string, number>();
  const failed = new Set<string>();

  const start = (module: Module) => {
    if (started.has(module.path)) return;
    started.set(module.path, performance.now());
    reporter.emit({ type: "target.start", target: modules!.summary(module, params.profile) });
  };
  const end = (module: Module) => {
    const outputs = graph.tasks()
      .filter(t => t.modulePath === module.path && (t instanceof CArchive || t instanceof CLink))
      .map(t => (t as CArchive | CLink).file.get());
    reporter.emit({ type: "target.end", target: module.name, duration: performance.now() - started.get(module.path)!, outputs });
  };

  // Modules without tasks (prebuilt libraries) are done as soon as the build starts.
  for (const module of ordered) {
    if (!pending.has(module.path)) {
      start(module);
      end(module);
    }
  }

  return {
    taskStart: task => {
      const module = build.module(task.modulePath);
      if (module && modules?.has(module)) start(module);
    },
    taskReport: (_task, event) => reporter.emit(event as ReportEvent),
    taskEnd: (task, outcome) => {
      if (outcome.kind === "up-to-date" && task instanceof CCompile) {
        for (const unit of task.units()) {
          reporter.emit({ type: "compile", target: task.label, file: unit.file, status: "cached", duration: 0, command: unit.command, diagnostics: "" });
        }
      }
      if (outcome.kind === "failed" || outcome.kind === "skipped") failed.add(task.modulePath);
      const left = pending.get(task.modulePath);
      left?.delete(task.path);
      const module = build.module(task.modulePath);
      if (left?.size === 0 && !failed.has(task.modulePath) && module && modules?.has(module)) end(module);
    },
  };
}

export function cModules(open: OpenBuild): CModules | undefined {
  return open.build.services.find(C_MODULES);
}
