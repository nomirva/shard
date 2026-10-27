import { extension, LifecycleTask, Task, type Configurable, type Module, type Plugin, type TaskProvider } from "../../core";
import { ShardError } from "../../utils/errors";
import { isPlainObject } from "../../utils/object";
import { shellSync } from "../../utils/process";

const OUTPUT_TAIL_LINES = 20;

/** Script names the plugin binds to the module's own tasks. */
export const HOOKS = ["preload", "prebuild", "postbuild", "preclean"] as const;
export type HookName = (typeof HOOKS)[number];

/** A shell command run in the module directory. */
export class Script extends Task {
  readonly command = this.input<string>("command");
  /** The script's name in the `scripts` block. */
  script = "";
  /** Output goes to the terminal (`shard run`) instead of being captured for the report. */
  inheritOutput = false;
  label = "";
  /** Captured output of the last run. */
  output = "";

  constructor(...args: ConstructorParameters<typeof Task>) {
    super(...args);
    this.alwaysRun = true;
  }

  run(): void {
    this.output = runScript(this.moduleDir, this.label, this.script, this.command.get(), this.inheritOutput);
  }
}

/** `scripts: { name: "command" }`. Every script is a task `script.<name>`; hooks are also bound by name. */
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

/**
 * Binds hooks to the module's tasks without knowing what they are:
 * - preload runs once configuration is over, before any task graph exists
 *   (it may generate sources that the module's scan must see);
 * - prebuild runs before every other task of the module;
 * - postbuild runs after the module's tasks in the build, if all succeeded;
 * - preclean is run by `shard clean`.
 */
function bindHook(module: Module, hook: HookName, task: TaskProvider<Script>, command: string): void {
  const isOwnWork = (t: Task) => !(t instanceof Script) && !(t instanceof LifecycleTask);
  if (hook === "preload") {
    module.onConfigured(() => { runScript(module.dir, module.name, hook, command, false); });
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
