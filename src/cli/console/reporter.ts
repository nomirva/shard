import { writeSync } from "fs";
import chalk from "chalk";
import { viewError } from "../../utils/errors";
import { countDiagnostics } from "../../utils/text";
import type { DepAction, DepInfo, ReportEvent, TreeShape } from "../../report/events";
import type { Reporter } from "../../report/reporter";
import { LiveArea } from "./live";
import { bar, renderTree, type TreeNode } from "./tree";
import { duration, indentBlock, pad, plural, rel, shortenPaths, stripAnsi } from "./format";

export interface ConsoleOptions {
  live: boolean;
  verbose: boolean;
  write?: (s: string) => void;
  columns?: () => number;
  rows?: () => number;
  now?: () => number;
  graceMs?: number;
}

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

interface DepNode {
  info: DepInfo;
  state: "pending" | "active" | "done" | "failed";
  action?: DepAction;
  previous?: string;
  percent: number;
  duration: number;
  children: number[];
}

interface ModuleState {
  state: "waiting" | "active" | "done" | "cached" | "failed";
  files: number;
  compiled: number;
  cached: number;
  file: string | null;
  duration: number;
}

interface HookRow {
  hook: string;
  command: string;
  state: "running" | "failed";
}

type Phase = { kind: "resolve" | "hooks" | "build"; title: string; startedAt: number };

const HOOK_PHASE_TITLE: Record<string, string> = { preload: "Preparing", preclean: "Cleaning" };
const COMMAND_WIDTH = 40;

export class ConsoleReporter implements Reporter {
  private readonly area: LiveArea;
  private readonly live: boolean;
  private readonly verbose: boolean;
  private readonly rows: () => number;
  private readonly now: () => number;
  private readonly graceMs: number;

  private run: { startedAt: number } | null = null;
  private phase: Phase | null = null;

  private rootName: string | null = null;
  private readonly rootDeps: number[] = [];
  private readonly deps = new Map<number, DepNode>();
  private activeDep: number | null = null;

  private tree: TreeShape | null = null;
  private readonly modules = new Map<string, ModuleState>();
  private currentModule: string | null = null;

  private readonly hooks = new Map<string, HookRow[]>();
  private runningHook: { target: string; hook: string } | null = null;

  private readonly stats = {
    modules: 0,
    compiled: 0,
    cached: 0,
    warnings: 0,
    installed: [] as { name: string; spec: string }[],
    upgraded: [] as { name: string; from: string; to: string }[],
  };

  constructor(options: ConsoleOptions) {
    this.live = options.live;
    this.verbose = options.verbose;
    this.rows = options.rows ?? (() => 24);
    this.now = options.now ?? (() => performance.now());
    this.graceMs = options.graceMs ?? 150;
    const write = options.write ?? (s => writeSync(2, s));
    this.area = new LiveArea(options.live, write, options.columns ?? (() => 80), frame => this.liveLines(frame));
  }

  print(line = ""): void {
    this.area.print(line);
  }

  emit(event: ReportEvent): void {
    switch (event.type) {
      case "run.start":
        this.run = { startedAt: this.now() };
        if (this.verbose) this.print(` ${chalk.dim(event.details.join(" · "))}`);
        return;

      case "deps.declared": {
        const ids = event.deps.map(d => d.id);
        if (event.parentId === null) {
          this.rootName = event.parent;
          this.rootDeps.push(...ids);
        } else {
          this.deps.get(event.parentId)?.children.push(...ids);
        }
        for (const info of event.deps) {
          this.deps.set(info.id, { info, state: "pending", percent: 0, duration: 0, children: [] });
        }
        this.startPhase("resolve", "Resolving");
        return;
      }

      case "dep.start": {
        const node = this.deps.get(event.id);
        if (node) node.state = "active";
        this.activeDep = event.id;
        this.area.refresh();
        return;
      }

      case "dep.progress": {
        const node = this.deps.get(event.id);
        if (node) node.percent = event.percent;
        this.area.refresh();
        return;
      }

      case "dep.done":
        this.depDone(event);
        return;

      case "resolve.end":
        this.endPhase();
        return;

      case "hook.start": {
        const rows = this.hooks.get(event.target) ?? [];
        rows.push({ hook: event.hook, command: event.command, state: "running" });
        this.hooks.set(event.target, rows);
        this.runningHook = { target: event.target, hook: event.hook };
        if (this.phase?.kind !== "build") this.startPhase("hooks", HOOK_PHASE_TITLE[event.hook] ?? "Running hooks");
        this.area.refresh();
        return;
      }

      case "hook": {
        const rows = this.hooks.get(event.target) ?? [];
        this.hooks.set(event.target, rows.filter(r => !(r.hook === event.hook && r.state === "running")));
        this.runningHook = null;
        this.area.refresh();
        if (!this.live && !this.verbose) {
          this.print(` ${chalk.dim("▸")} ${event.target} · ${event.hook}  ${chalk.dim(duration(event.duration))}`);
        }
        if (this.verbose) {
          this.print(`   ${chalk.dim("▸")} ${event.target} · ${event.hook}  ${chalk.dim(event.command)}  ${chalk.dim(duration(event.duration))}`);
          if (event.output) this.print(indentBlock(chalk.dim(event.output), "       "));
        }
        return;
      }

      case "build.start":
        this.tree = event.tree;
        this.stats.modules = event.targets.length;
        for (const summary of event.targets) {
          this.modules.set(summary.name, {
            state: "waiting", files: summary.files, compiled: 0, cached: 0, file: null, duration: 0,
          });
        }
        this.startPhase("build", "Building");
        return;

      case "target.start": {
        const module = this.modules.get(event.target.name);
        if (module) module.state = "active";
        this.currentModule = event.target.name;
        this.area.refresh();
        return;
      }

      case "compile.start": {
        const module = this.modules.get(event.target);
        if (module) module.file = event.file;
        this.area.refresh();
        return;
      }

      case "compile":
        this.compiled(event);
        return;

      case "link":
        if (this.verbose) {
          this.print(`   ${chalk.cyan("→")} ${rel(event.output)}  ${chalk.dim(duration(event.duration))}`);
          this.print(`     ${chalk.dim("$ " + shortenPaths(event.command))}`);
        }
        return;

      case "target.end": {
        const module = this.modules.get(event.target);
        if (module) {
          module.state = module.compiled === 0 && module.cached > 0 ? "cached" : "done";
          module.duration = event.duration;
          if (!this.live && !this.verbose) {
            this.print(module.state === "cached"
              ? ` ${chalk.dim("≡")} ${event.target}  ${chalk.dim("cached")}`
              : ` ${chalk.green("✔")} ${event.target}  ${chalk.dim(duration(event.duration))}`);
          }
        }
        this.currentModule = null;
        this.area.refresh();
        return;
      }

      case "warning":
        this.stats.warnings++;
        this.print(` ${chalk.yellow("⚠")} ${event.message}`);
        return;

      case "run.end":
        this.endPhase();
        this.area.stop();
        if (event.command === "build") this.buildSummary(event.subject, event.artifacts);
        else this.updateSummary(event.removed ?? []);
        return;

      case "program.start":
        this.print(` ${chalk.dim(`── running ${event.name} ──`)}`);
        return;

      case "program.end":
        this.print(` ${chalk.dim(`── ${event.name} exited with code ${event.status} ──`)}`);
        return;
    }
  }

  error(e: unknown): void {
    const { code, message, hint, details, output } = viewError(e);
    const crumb = this.breadcrumb(code);
    if (this.runningHook) {
      const row = this.hooks.get(this.runningHook.target)?.find(r => r.state === "running");
      if (row) row.state = "failed";
    }
    this.phase = null;
    this.area.stop();

    const text = shortenPaths(message);
    this.print();
    if (crumb) {
      this.print(` ${chalk.red("✘")} ${chalk.bold(crumb)}`);
      this.print(`   ${text}`);
    } else {
      this.print(` ${chalk.red("✘")} ${chalk.bold(text)}`);
    }
    if (hint) this.print(`   ${chalk.dim(shortenPaths(hint))}`);
    const width = Math.max(0, ...details.map(([label]) => label.length));
    for (const [label, value] of details) {
      this.print(`   ${chalk.dim(pad(label, width))}  ${chalk.dim(shortenPaths(value))}`);
    }
    if (output?.trim()) {
      this.print();
      this.print(indentBlock(shortenPaths(output), `   ${chalk.dim("│")} `));
    }
    this.print();
  }

  private depDone(event: Extract<ReportEvent, { type: "dep.done" }>): void {
    const node = this.deps.get(event.dep.id);
    if (node) {
      node.state = "done";
      node.action = event.action;
      node.previous = event.previous;
      node.duration = event.duration;
    }
    if (this.activeDep === event.dep.id) this.activeDep = null;

    const name = displayName(event.dep);
    if (event.action === "installed") this.stats.installed.push({ name, spec: event.dep.spec });
    if (event.action === "upgraded") this.stats.upgraded.push({ name, from: event.previous ?? "?", to: event.dep.spec });

    for (const warning of event.warnings) {
      this.stats.warnings++;
      this.print(` ${chalk.yellow("⚠")} ${name}: ${warning}`);
    }

    if (this.verbose) {
      const parts = [`   ${depMark(event.action)} ${name}`, chalk.dim(event.dep.source)];
      if (event.dep.source === "git") parts.push(depColumn(event.dep, event.action, event.previous));
      if (event.flags?.length) parts.push(chalk.dim(event.flags.join(" ")));
      if (event.path && event.action !== "linked") parts.push(chalk.dim(rel(event.path)));
      this.print(parts.join("  "));
    } else if (!this.live && (event.action === "installed" || event.action === "upgraded")) {
      const what = event.action === "upgraded" ? `${event.previous} → ${event.dep.spec}` : event.dep.spec;
      this.print(` ${depMark(event.action)} ${name}  ${what}  ${chalk.dim(duration(event.duration))}`);
    }
    this.area.refresh();
  }

  private compiled(event: Extract<ReportEvent, { type: "compile" }>): void {
    const module = this.modules.get(event.target);
    if (event.status === "cached") this.stats.cached++;
    if (event.status === "compiled") this.stats.compiled++;
    if (module) {
      module.file = null;
      if (event.status === "cached") module.cached++;
      if (event.status === "compiled") module.compiled++;
      if (event.status === "failed") module.state = "failed";
    }
    if (this.verbose) {
      const mark = { cached: chalk.dim("≡"), compiled: chalk.green("✔"), failed: chalk.red("✘") }[event.status];
      const time = event.status === "cached" ? "cached" : duration(event.duration);
      this.print(`   ${mark} ${event.target}/${event.file}  ${chalk.dim(time)}`);
      this.print(`     ${chalk.dim("$ " + shortenPaths(event.command))}`);
    }
    if (event.diagnostics.trim()) {
      this.stats.warnings += countDiagnostics(event.diagnostics, "warning");
      const text = withoutTally(shortenPaths(colorless(event.diagnostics)));
      if (text.trim()) this.print(indentBlock(text, " "));
    }
  }

  finish(): void {
    this.endPhase();
    this.area.stop();
  }

  private startPhase(kind: Phase["kind"], title: string): void {
    if (this.phase?.kind === kind && this.phase.title === title) return;
    this.phase = { kind, title, startedAt: this.now() };
    this.area.start();
    this.area.refresh();
  }

  private endPhase(): void {
    this.phase = null;
    this.area.refresh();
  }

  private liveLines(frame: number): string[] {
    const phase = this.phase;
    if (!phase || this.now() - phase.startedAt < this.graceMs) return [];
    const elapsed = duration(this.now() - phase.startedAt);
    const spin = chalk.cyan(SPINNER[frame % SPINNER.length]);
    const maxLines = Math.max(4, this.rows() - 2);

    if (phase.kind === "resolve") {
      const nodes = [...this.deps.values()];
      const done = nodes.filter(n => n.state === "done").length;
      const root: TreeNode = {
        name: this.rootName ?? "",
        columns: [],
        status: "",
        done: true,
        children: this.rootDeps.map(id => this.depTree(id, spin)),
      };
      return renderTree("Resolving", `${done}/${nodes.length}  ${elapsed}`, root, maxLines);
    }

    if (phase.kind === "hooks") {
      return this.runningHook ? renderTree(phase.title, elapsed, this.hookTree(spin), maxLines) : [];
    }

    if (!this.tree) return [];
    const finished = [...this.modules.values()].filter(m => m.state === "done" || m.state === "cached").length;
    return renderTree("Building", `${finished}/${this.modules.size}  ${elapsed}`, this.moduleTree(this.tree, spin), maxLines);
  }

  private depTree(id: number, spin: string): TreeNode {
    const node = this.deps.get(id)!;
    const { info } = node;
    let status: string;
    switch (node.state) {
      case "pending": status = chalk.dim("○"); break;
      case "active": status = node.percent > 0 ? `${bar(node.percent, 100)} ${node.percent}%` : spin; break;
      case "failed": status = chalk.red("✘"); break;
      case "done":
        status = depMark(node.action!);
        if (node.action === "installed" || node.action === "upgraded") status += "  " + chalk.dim(duration(node.duration));
    }
    return {
      name: displayName(info),
      columns: [chalk.dim(depColumn(info, node.action, node.previous))],
      status,
      dim: node.action === "duplicate",
      done: node.state === "done",
      children: node.children.map(child => this.depTree(child, spin)),
    };
  }

  private moduleTree(shape: TreeShape, spin: string): TreeNode {
    const module = this.modules.get(shape.name);
    if (shape.repeat || !module) {
      return { name: shape.name, columns: [], status: chalk.dim("·"), dim: true, done: true, children: [] };
    }
    let status: string;
    switch (module.state) {
      case "waiting": status = chalk.dim("○"); break;
      case "failed": status = chalk.red("✘"); break;
      case "cached": status = `${chalk.dim("≡")}  ${chalk.dim("cached")}`; break;
      case "done": status = `${chalk.green("✔")}  ${duration(module.duration)}`; break;
      case "active": {
        const progressed = module.compiled + module.cached;
        if (module.files === 0) status = spin;
        else status = `${bar(progressed, module.files, 10)} ${progressed}/${module.files}${module.file ? "  " + chalk.dim(module.file) : ""}`;
      }
    }
    return {
      name: shape.name,
      columns: [],
      status,
      done: module.state === "done" || module.state === "cached",
      children: [
        ...this.hookRows(shape.name, spin, hook => hook !== "preload"),
        ...shape.children.map(child => this.moduleTree(child, spin)),
      ],
    };
  }

  private hookRows(target: string, spin: string, include: (hook: string) => boolean = () => true): TreeNode[] {
    return (this.hooks.get(target) ?? []).filter(row => include(row.hook)).map((row): TreeNode => {
      const command = row.command.length > COMMAND_WIDTH ? row.command.slice(0, COMMAND_WIDTH - 1) + "…" : row.command;
      const state = row.state === "running"
        ? `${spin} ${chalk.cyan("hook is running…")}`
        : `${chalk.red("✘")} ${chalk.red("hook failed")}`;
      return { name: chalk.dim("▸ ") + row.hook, columns: [], status: `${state}  ${chalk.dim(command)}`, done: false, children: [] };
    });
  }

  private hookTree(spin: string): TreeNode {
    const branch = (id: number): TreeNode | null => {
      const node = this.deps.get(id)!;
      if (node.action === "duplicate") return null;
      const name = displayName(node.info);
      const children = [...this.hookRows(name, spin), ...node.children.map(branch).filter((n): n is TreeNode => n !== null)];
      return children.length > 0 ? { name, columns: [], status: "", done: true, children } : null;
    };
    const rootName = this.rootName ?? this.runningHook?.target ?? [...this.hooks.keys()][0] ?? "";
    return {
      name: rootName,
      columns: [],
      status: "",
      done: true,
      children: [
        ...this.hookRows(rootName, spin),
        ...this.rootDeps.map(branch).filter((n): n is TreeNode => n !== null),
      ],
    };
  }

  private breadcrumb(code: string): string | null {
    if (this.runningHook) {
      const { target, hook } = this.runningHook;
      const path = (this.tree && findPath(this.tree, target)) ?? this.depPath(target) ?? [target];
      return `${path.join(" › ")} · ${hook}`;
    }
    if (this.phase?.kind === "resolve" && this.activeDep !== null && this.rootName) {
      const names: string[] = [];
      for (let id: number | null = this.activeDep; id !== null; id = this.deps.get(id)?.info.parentId ?? null) {
        const node = this.deps.get(id);
        if (!node) break;
        names.unshift(displayName(node.info));
      }
      return [this.rootName, ...names].join(" › ");
    }
    if (this.phase?.kind === "build" && this.currentModule && this.tree && code !== "build") {
      return findPath(this.tree, this.currentModule)?.join(" › ") ?? this.currentModule;
    }
    return null;
  }

  private depPath(name: string): string[] | null {
    if (!this.rootName) return null;
    if (name === this.rootName) return [name];
    for (const [id, node] of this.deps) {
      if (displayName(node.info) !== name || node.action === "duplicate") continue;
      const names: string[] = [];
      for (let cur: number | null = id; cur !== null; cur = this.deps.get(cur)?.info.parentId ?? null) {
        names.unshift(displayName(this.deps.get(cur)!.info));
      }
      return [this.rootName, ...names];
    }
    return null;
  }

  private buildSummary(subject: string, artifacts: string[]): void {
    const s = this.stats;
    const changes = this.changeLines();
    const time = this.run ? ` in ${duration(this.now() - this.run.startedAt)}` : "";
    this.print();
    if (s.compiled === 0 && s.cached > 0 && changes.length === 0 && s.warnings === 0) {
      this.print(` ${chalk.green("✔")} ${chalk.bold(subject)} is up to date ${chalk.dim(`· ${plural(s.modules, "module")} cached`)}`);
    } else {
      this.print(` ${chalk.green("✔")} ${chalk.bold(subject)} built${time}`);
      const counters = [plural(s.modules, "module"), `${s.compiled} compiled`];
      if (s.cached) counters.push(`${s.cached} cached`);
      if (s.warnings) counters.push(chalk.yellow(plural(s.warnings, "warning")));
      this.print(`   ${counters.join(chalk.dim(" · "))}`);
      for (const line of changes) this.print(`   ${line}`);
    }
    for (const artifact of artifacts) this.print(`   ${chalk.cyan("→")} ${rel(artifact)}`);
    this.print();
  }

  private updateSummary(removed: string[]): void {
    const changes = [...this.changeLines(), ...removed.map(name => `${chalk.red("−")} ${name}`)];
    const time = this.run ? ` in ${duration(this.now() - this.run.startedAt)}` : "";
    this.print();
    this.print(changes.length === 0
      ? ` ${chalk.green("✔")} ${chalk.bold("modules up to date")}`
      : ` ${chalk.green("✔")} ${chalk.bold("modules synced")}${time}`);
    for (const line of changes) this.print(`   ${line}`);
    if (this.stats.warnings) this.print(`   ${chalk.yellow(plural(this.stats.warnings, "warning"))}`);
    this.print();
  }

  private changeLines(): string[] {
    return [
      ...this.stats.installed.map(d => `${chalk.green("↓")} ${d.name} ${d.spec}`),
      ...this.stats.upgraded.map(d => `${chalk.yellow("↻")} ${d.name} ${d.from} → ${d.to}`),
    ];
  }
}

function depMark(action: DepAction): string {
  switch (action) {
    case "installed": return chalk.green("↓");
    case "upgraded": return chalk.yellow("↻");
    case "duplicate": return chalk.dim("·");
    default: return chalk.green("✓");
  }
}

function depColumn(info: DepInfo, action?: DepAction, previous?: string): string {
  if (info.source !== "git") return info.source;
  return action === "upgraded" && previous ? `${previous} → ${info.spec}` : info.spec;
}

function displayName(info: DepInfo): string {
  return info.source === "system" || info.source === "framework" ? info.spec : info.name;
}

function findPath(shape: TreeShape, name: string): string[] | null {
  if (shape.name === name && !shape.repeat) return [name];
  for (const child of shape.children) {
    const path = findPath(child, name);
    if (path) return [shape.name, ...path];
  }
  return null;
}

function withoutTally(text: string): string {
  return text.split("\n").filter(line => !/^\d+ (error|warning)s? (and \d+ (error|warning)s? )?generated\.$/.test(stripAnsi(line).trim())).join("\n");
}

function colorless(text: string): string {
  return chalk.level === 0 ? stripAnsi(text) : text;
}
