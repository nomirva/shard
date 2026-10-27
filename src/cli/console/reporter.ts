import { writeSync } from "fs";
import { basename } from "path";
import chalk from "chalk";
import { viewError } from "../../utils/errors";
import type { DepAction, DepInfo, ReportEvent, TargetSummary } from "../../report/events";
import type { Reporter } from "../../report/reporter";
import { LiveArea } from "./live";
import { duration, indentBlock, pad, plural, rel, shortenPaths, stripAnsi } from "./format";

export interface ConsoleOptions {
  /** Redraw spinners in place (TTY); otherwise append plain, deterministic lines. */
  live: boolean;
  /** Show every file, command line, hook output and install path. */
  verbose: boolean;
  write?: (s: string) => void;
  columns?: () => number;
}

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

const DEP_MARK: Record<DepAction, string> = {
  local: chalk.green("✓"),
  linked: chalk.cyan("⚙"),
  installed: chalk.green("↓"),
  upgraded: chalk.yellow("↻"),
  reused: chalk.dim("≡"),
  duplicate: chalk.dim("·"),
};

interface TargetView {
  summary: TargetSummary;
  file: string | null;
  compiled: number;
  cached: number;
  failed: boolean;
  outputs: string[];
  /** Lines printed under the module line once it is final (live mode). */
  details: string[];
}

interface Columns {
  name: number;
  shape: number;
  settings: number;
  files: number;
}

/** Renders pipeline events to stderr: live spinners in a TTY, plain lines elsewhere. */
export class ConsoleReporter implements Reporter {
  private readonly area: LiveArea;
  private readonly live: boolean;
  private readonly verbose: boolean;
  private readonly write: (s: string) => void;

  private run: { noun: string; startedAt: number } | null = null;
  private readonly pending = new Map<number, { dep: DepInfo; percent: number }>();
  private readonly sections = new Set<string>();
  private columns: Columns | null = null;
  private current: TargetView | null = null;
  private readonly stats = { compiled: 0, cached: 0, warnings: 0, installed: 0, upgraded: 0, built: false };

  constructor(options: ConsoleOptions) {
    this.live = options.live;
    this.verbose = options.verbose;
    this.write = options.write ?? (s => writeSync(2, s));
    this.area = new LiveArea(options.live, this.write, options.columns ?? (() => 80), frame => this.liveLines(frame));
  }

  /** Free-form output line for commands (update, clean, ...). */
  print(line = ""): void {
    this.area.print(line);
  }

  emit(event: ReportEvent): void {
    switch (event.type) {
      case "run.start":
        this.run = { noun: event.noun, startedAt: performance.now() };
        this.print();
        this.print(` ${chalk.bold(event.title)}${chalk.dim(event.details.map(d => " · " + d).join(""))}`);
        return;

      case "dep.start":
        this.section("Dependencies");
        this.pending.set(event.dep.id, { dep: event.dep, percent: 0 });
        this.area.refresh();
        return;

      case "dep.progress": {
        const entry = this.pending.get(event.id);
        if (entry) entry.percent = event.percent;
        return;
      }

      case "dep.done":
        this.pending.delete(event.dep.id);
        if (event.action === "installed") this.stats.installed++;
        if (event.action === "upgraded") this.stats.upgraded++;
        this.stats.warnings += event.warnings.length;
        this.print(this.depLine(event));
        if (this.verbose && event.path && event.action !== "linked") {
          this.print(`${depIndent(event.dep)}  ${chalk.dim(rel(event.path))}`);
        }
        return;

      case "hook":
        this.hook(event);
        return;

      case "build.start":
        this.stats.built = true;
        this.columns = columnsFor(event.targets);
        this.section(`Building ${plural(event.targets.length, "module")}`);
        return;

      case "target.start":
        this.current = { summary: event.target, file: null, compiled: 0, cached: 0, failed: false, outputs: [], details: [] };
        if (!this.live) this.print(`   ${chalk.bold(event.target.name)} ${chalk.dim(`(${describe(event.target)})`)}`);
        this.area.refresh();
        return;

      case "compile.start":
        if (this.current) this.current.file = event.file;
        this.area.refresh();
        return;

      case "compile": {
        const view = this.current;
        if (event.status === "cached") this.stats.cached++;
        if (event.status === "compiled") this.stats.compiled++;
        this.stats.warnings += countWarnings(event.diagnostics);
        if (!view) return;
        if (event.status === "cached") view.cached++;
        if (event.status === "compiled") view.compiled++;
        if (event.status === "failed") view.failed = true;
        view.file = null;

        const lines: string[] = [];
        if (!this.live || this.verbose) {
          const mark = { cached: chalk.dim("≡"), compiled: chalk.green("✔"), failed: chalk.red("✘") }[event.status];
          const time = event.status === "cached" ? chalk.dim("cached") : chalk.dim(duration(event.duration));
          lines.push(`     ${mark} ${event.file}  ${time}`);
          if (this.verbose) lines.push(`       ${chalk.dim("$ " + shortenPaths(event.command))}`);
        }
        if (event.diagnostics.trim()) lines.push(indentBlock(shortenPaths(colorless(event.diagnostics)), "       "));
        this.detail(lines);
        return;
      }

      case "link":
        this.current?.outputs.push(event.output);
        if (!this.live || this.verbose) {
          const lines = [`     ${chalk.cyan("→")} ${rel(event.output)}  ${chalk.dim(duration(event.duration))}`];
          if (this.verbose) lines.push(`       ${chalk.dim("$ " + shortenPaths(event.command))}`);
          this.detail(lines);
        }
        return;

      case "target.end":
        if (this.current && this.live) this.finishTarget(this.current, event.duration);
        this.current = null;
        this.area.refresh();
        return;

      case "warning":
        this.stats.warnings++;
        this.print(`   ${chalk.yellow("⚠")} ${chalk.yellow(event.message)}`);
        return;

      case "run.end":
        this.summary(event.label, event.artifacts, event.stats ?? []);
        return;

      case "program.start":
        this.print(` ${chalk.dim(`── running ${event.name} ──`)}`);
        return;

      case "program.end":
        this.print(` ${chalk.dim(`── ${event.name} exited with code ${event.status} ──`)}`);
        return;
    }
  }

  /** Renders a failure: closes whatever is in flight, then the error block. */
  error(e: unknown): void {
    for (const { dep } of this.pending.values()) {
      this.print(`${depIndent(dep)}${chalk.red("✘")} ${pad(dep.name, 10)}  ${pad(dep.source, 9)}  ${dep.spec}`);
    }
    this.pending.clear();
    if (this.current) {
      this.current.failed = true;
      if (this.live) this.finishTarget(this.current, null);
      this.current = null;
    }
    this.area.stop();

    const { message, hint, details, output } = viewError(e);
    const rows: [string, string][] = [...details];
    if (hint) rows.push(["hint", hint]);
    const width = Math.max(0, ...rows.map(([label]) => label.length));

    this.print();
    this.print(` ${chalk.red("✘")} ${chalk.bold(shortenPaths(message))}`);
    for (const [label, value] of rows) {
      const text = shortenPaths(value);
      this.print(`   ${chalk.dim(pad(label, width))}  ${label === "hint" ? chalk.dim(text) : text}`);
    }
    if (output?.trim()) {
      this.print();
      this.print(indentBlock(shortenPaths(output), `   ${chalk.dim("│")} `));
    }
    if (this.run) {
      this.print();
      this.print(` ${chalk.red("✘")} ${this.run.noun} failed after ${duration(performance.now() - this.run.startedAt)}`);
    }
    this.print();
  }

  private section(title: string): void {
    if (this.sections.has(title)) return;
    this.sections.add(title);
    this.print();
    this.print(` ${chalk.bold(title)}`);
  }

  private depLine(event: Extract<ReportEvent, { type: "dep.done" }>): string {
    const { dep, action } = event;
    const head = `${depIndent(dep)}${DEP_MARK[action]} `;
    if (action === "duplicate") return head + chalk.dim(`${dep.name}  (already resolved)`);

    if (action === "linked") {
      // System libraries are named by what they link, e.g. "m" → -lm.
      const parts = [pad(dep.spec, 10), pad(chalk.dim(dep.source), 9), chalk.dim((event.flags ?? []).join(" "))];
      for (const warning of event.warnings) parts.push(`${chalk.yellow("⚠")} ${chalk.yellow(warning)}`);
      return head + parts.join("  ");
    }

    const spec = action === "upgraded" && event.previous ? `${event.previous} → ${dep.spec}` : dep.spec;
    const parts = [pad(dep.name, 10), pad(chalk.dim(dep.source), 9), spec];
    if (dep.link) parts.push(chalk.dim(dep.link));
    if (action === "installed" || action === "upgraded") parts.push(chalk.dim(`${action} ${duration(event.duration)}`));
    if (action === "reused") parts.push(chalk.dim("reused"));
    for (const warning of event.warnings) parts.push(`${chalk.yellow("⚠")} ${chalk.yellow(warning)}`);
    return head + parts.join("  ");
  }

  private hook(event: Extract<ReportEvent, { type: "hook" }>): void {
    const inTarget = this.current?.summary.name === event.target;
    if (!inTarget && event.hook === "preload") this.section("Preparing");
    const label = inTarget ? event.hook : `${event.target} · ${event.hook}`;
    const indent = inTarget ? "     " : "   ";
    const lines = [`${indent}${chalk.dim("▸")} ${chalk.dim(label)}  ${chalk.dim(event.command)}  ${chalk.dim(duration(event.duration))}`];
    if (this.verbose && event.output) lines.push(indentBlock(chalk.dim(event.output), indent + "  "));
    if (inTarget) this.detail(lines);
    else for (const line of lines) this.print(line);
  }

  /** In live mode details wait for the final module line; otherwise they print immediately. */
  private detail(lines: string[]): void {
    if (this.live && this.current) this.current.details.push(...lines);
    else for (const line of lines) this.print(line);
  }

  private finishTarget(view: TargetView, ms: number | null): void {
    let status: string;
    if (view.failed) status = `${chalk.red("✘")} ${chalk.red("failed")}`;
    else if (view.compiled === 0 && view.cached > 0) status = `${chalk.dim("≡")} ${chalk.dim("cached")}`;
    else {
      status = `${chalk.green("✔")} ${duration(ms ?? 0)}`;
      if (view.cached > 0) status += chalk.dim(` (${view.cached} cached)`);
    }
    if (view.outputs.length > 0 && !view.failed) {
      status += `  ${chalk.dim("→ " + view.outputs.map(o => basename(o)).join(", "))}`;
    }
    this.print(this.targetLine(view.summary, status));
    for (const line of view.details) this.print(line);
  }

  private targetLine(t: TargetSummary, status: string): string {
    const c = this.columns ?? columnsFor([t]);
    return `   ${pad(chalk.bold(t.name), c.name)}  ${pad(chalk.dim(t.shape), c.shape)}  ${pad(chalk.dim(settingsOf(t)), c.settings)}  ${pad(chalk.dim(filesOf(t)), c.files)}  ${status}`;
  }

  private liveLines(frame: number): string[] {
    const spin = chalk.cyan(SPINNER[frame % SPINNER.length]);
    const lines: string[] = [];
    for (const { dep, percent } of this.pending.values()) {
      const pct = percent > 0 ? chalk.dim(` [${percent}%]`) : "";
      lines.push(`${depIndent(dep)}${spin} ${pad(dep.name, 10)}  ${pad(chalk.dim(dep.source), 9)}  ${dep.spec}${pct}`);
    }
    if (this.current) lines.push(this.targetLine(this.current.summary, `${spin} ${chalk.dim(this.current.file ?? "")}`));
    return lines;
  }

  private summary(label: string, artifacts: string[], extra: string[]): void {
    const s = this.stats;
    const stats = [...extra];
    if (s.installed) stats.push(`${s.installed} installed`);
    if (s.upgraded) stats.push(`${s.upgraded} upgraded`);
    if (s.built) {
      if (s.compiled || !s.cached) stats.push(`${s.compiled} compiled`);
      if (s.cached) stats.push(`${s.cached} cached`);
    }
    if (s.warnings) stats.push(chalk.yellow(plural(s.warnings, "warning")));

    const time = this.run ? ` in ${duration(performance.now() - this.run.startedAt)}` : "";
    const tail = stats.length ? chalk.dim("  ·  ") + stats.join(chalk.dim("  ·  ")) : "";
    this.print();
    this.print(` ${chalk.green("✔")} ${chalk.bold(label)}${time}${tail}`);
    for (const artifact of artifacts) this.print(`   ${chalk.cyan("→")} ${rel(artifact)}`);
    this.print();
  }
}

function depIndent(dep: DepInfo): string {
  return "   " + "  ".repeat(dep.depth);
}

function settingsOf(t: TargetSummary): string {
  return `${t.standard ?? "—"} · ${t.profile}`;
}

function filesOf(t: TargetSummary): string {
  return t.files > 0 ? plural(t.files, "file") : "—";
}

function describe(t: TargetSummary): string {
  return `${t.shape} · ${settingsOf(t)}`;
}

function columnsFor(targets: readonly TargetSummary[]): Columns {
  const width = (f: (t: TargetSummary) => string): number => Math.max(0, ...targets.map(t => f(t).length));
  return {
    name: width(t => t.name),
    shape: width(t => t.shape),
    settings: width(settingsOf),
    files: width(filesOf),
  };
}

/** Compiler output is always colored; drop the colors when the console has none. */
function colorless(text: string): string {
  return chalk.level === 0 ? stripAnsi(text) : text;
}

function countWarnings(diagnostics: string): number {
  return stripAnsi(diagnostics).split("\n").filter(line => /\bwarning:/.test(line)).length;
}
