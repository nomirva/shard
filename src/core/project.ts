import { ShardError } from "../utils/errors";
import { TaskContainer, type TaskProvider } from "./tasks";
import type { Task } from "./task";

/**
 * Extends a project: registers tasks, extensions and (later) configurations.
 * `apply` runs once per project; reacting to other plugins goes through
 * `project.plugins.withId`, never through application order.
 */
export interface Plugin {
  readonly id: string;
  apply(project: Project): void;
}

export class PluginContainer {
  private readonly applied = new Map<string, Plugin>();
  private readonly waiting = new Map<string, ((plugin: Plugin) => void)[]>();

  constructor(private readonly project: Project) {}

  apply(plugin: Plugin): void {
    if (this.applied.has(plugin.id)) return;
    this.applied.set(plugin.id, plugin);
    plugin.apply(this.project);
    for (const action of this.waiting.get(plugin.id) ?? []) action(plugin);
    this.waiting.delete(plugin.id);
  }

  has(id: string): boolean {
    return this.applied.has(id);
  }

  /** Runs `action` now if the plugin is applied, otherwise right after it is. */
  withId(id: string, action: (plugin: Plugin) => void): void {
    const plugin = this.applied.get(id);
    if (plugin) action(plugin);
    else this.waiting.set(id, [...(this.waiting.get(id) ?? []), action]);
  }
}

/** A typed handle for an extension, so `get` needs no cast: `const C = extension<CExtension>("c")`. */
export interface ExtensionKey<T> {
  readonly name: string;
  /** Type marker only. */
  readonly _type?: T;
}

export function extension<T>(name: string): ExtensionKey<T> {
  return { name };
}

/** DSL blocks contributed by plugins, e.g. `c { standard }`. */
export class ExtensionContainer {
  private readonly values = new Map<string, unknown>();

  constructor(private readonly projectPath: string) {}

  add<T>(key: ExtensionKey<T>, value: T): T {
    if (this.values.has(key.name)) {
      throw new ShardError("config", `Extension "${key.name}" already exists in ${this.projectPath}`);
    }
    this.values.set(key.name, value);
    return value;
  }

  get<T>(key: ExtensionKey<T>): T {
    if (!this.values.has(key.name)) {
      throw new ShardError("config", `Extension "${key.name}" is not available in ${this.projectPath}`,
        "apply the plugin that provides it");
    }
    return this.values.get(key.name) as T;
  }

  find<T>(key: ExtensionKey<T>): T | undefined {
    return this.values.get(key.name) as T | undefined;
  }

  names(): string[] {
    return [...this.values.keys()];
  }
}

export interface ProjectInit {
  readonly name: string;
  /** ":" for the root, ":lib" for others. */
  readonly path: string;
  readonly dir: string;
  readonly buildDir: string;
}

/**
 * One module of the build. A project holds registries and nothing else; it
 * has no way to reach other projects, so they exchange data only through
 * published artifacts.
 */
export class Project {
  readonly name: string;
  readonly path: string;
  readonly dir: string;
  readonly buildDir: string;
  readonly tasks: TaskContainer;
  readonly extensions: ExtensionContainer;
  readonly plugins: PluginContainer;

  constructor(init: ProjectInit, onRegister: (task: TaskProvider<Task>) => void) {
    this.name = init.name;
    this.path = init.path;
    this.dir = init.dir;
    this.buildDir = init.buildDir;
    this.tasks = new TaskContainer(init.path, init.dir, init.buildDir, onRegister);
    this.extensions = new ExtensionContainer(init.path);
    this.plugins = new PluginContainer(this);
  }
}
