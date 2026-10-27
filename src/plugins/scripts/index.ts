import { extension, LifecycleTask, Task, type Configurable, type Module, type Plugin, type TaskContext, type TaskProvider } from "../../core";
import type { ReportEvent } from "../../report/events";
import { ShardError } from "../../utils/errors";
import { isPlainObject } from "../../utils/object";
import { shellSync } from "../../utils/process";

const OUTPUT_TAIL_LINES = 20;

export const HOOKS = ["preload", "prebuild", "postbuild", "preclean"] as const;
export type HookName = (typeof HOOKS)[number];

export class Script extends Task {
  readonly command = this.input<string>("command");
  script = "";
  inheritOutput = false;
  label = "";
  output = "";

  constructor(...args: ConstructorParameters<typeof Task>) {
    super(...args);
    this.alwaysRun = true;
  }

  run(ctx: TaskContext): void {
    const report = (event: ReportEvent) => ctx.report(event);
    if (this.inheritOutput) {
      runScript(this.moduleDir, this.label, this.script, this.command.get(), true);
      return;
    }
    this.output = reportedRun(report, this.moduleDir, this.label, this.script, this.command.get());
  }
}

export class ScriptsExtension implements Configurable {
  private readonly tasks = new Map<string, TaskProvider<Script>>();

  constructor(private readonly module: Module) {}

  task(name: string): TaskProvider<Script> | undefined {
    return this.tasks.get(name);
  }

  names(): string[] {
    return [...this.tasks.keys()];
  }

  configure(raw: unknown): void {
    if (!isPlainObject(raw) || Object.values(raw).some(v => typeof v !== "string")) {
      throw new ShardError("config", "The scripts block maps script names to shell commands");
    }
    for (const [name, command] of Object.entries(raw as Record<string, string>)) this.add(name, command);
  }

  add(name: string, command: string): TaskProvider<Script> {
    const module = this.module;
    const task = module.tasks.register(`script.${name}`, Script, t => {
      t.command.set(command);
      t.script = name;
      t.label = module.name;
      t.description = command;
    });
    this.tasks.set(name, task);
    bindHook(module, name as HookName, task, command);
    return task;
  }
}

export const SCRIPTS = extension<ScriptsExtension>("scripts");

function bindHook(module: Module, hook: HookName, task: TaskProvider<Script>, command: string): void {
  const isOwnWork = (t: Task) => !(t instanceof Script) && !(t instanceof LifecycleTask);
  if (hook === "preload") {
    module.onConfigured(() => { reportedRun(event => module.report(event), module.dir, module.name, hook, command); });
  } else if (hook === "prebuild") {
    module.tasks.configureEach(Task, t => { if (isOwnWork(t)) t.dependsOn(task); });
  } else if (hook === "postbuild") {
    task.configure(t => { t.finalizeOnSuccessOnly = true; });
    module.tasks.configureEach(Task, t => { if (isOwnWork(t)) t.finalizedBy(task); });
  }
}

export function scriptsPlugin(): Plugin {
  return {
    id: "scripts",
    apply(module) {
      module.extensions.add(SCRIPTS, new ScriptsExtension(module));
    },
  };
}

function reportedRun(report: (event: ReportEvent) => void, cwd: string, module: string, hook: string, command: string): string {
  report({ type: "hook.start", target: module, hook, command });
  const startedAt = performance.now();
  const output = runScript(cwd, module, hook, command, false);
  report({ type: "hook", target: module, hook, command, duration: performance.now() - startedAt, output });
  return output;
}

function runScript(cwd: string, module: string, name: string, command: string, inherit: boolean): string {
  const result = shellSync(cwd, command, inherit ? "inherit" : "pipe");
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  if (result.status !== 0) {
    throw new ShardError("script", `Script "${name}" failed (exit code ${result.status})`, undefined, {
      details: [["module", module], ["command", command], ["cwd", cwd]],
      output: output.split("\n").slice(-OUTPUT_TAIL_LINES).join("\n") || undefined,
    });
  }
  return output;
}
