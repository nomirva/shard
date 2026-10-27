import { ShardError } from "../utils/errors";
import type { AttributeSchema } from "./attributes";
import { ConfigurationContainer } from "./configurations";
import type { ResolutionServices } from "./resolution";
import type { ServiceRegistry } from "./services";
import { TaskContainer, type TaskProvider } from "./tasks";
import type { Task } from "./task";

/**
 * Extends a module: registers tasks, extensions and configurations.
 * `apply` runs once per module; reacting to other plugins goes through
 * `module.plugins.withId`, never through application order.
 */
export interface Plugin {
  readonly id: string;
  apply(module: Module): void;
}

export class PluginContainer {
  private readonly applied = new Map<string, Plugin>();
  private readonly waiting = new Map<string, ((plugin: Plugin) => void)[]>();

  constructor(private readonly module: Module) {}

  apply(plugin: Plugin): void {
    if (this.applied.has(plugin.id)) return;
    this.applied.set(plugin.id, plugin);
    plugin.apply(this.module);
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

  constructor(private readonly modulePath: string) {}

  add<T>(key: ExtensionKey<T>, value: T): T {
    if (this.values.has(key.name)) {
      throw new ShardError("config", `Extension "${key.name}" already exists in ${this.modulePath}`);
    }
    this.values.set(key.name, value);
    return value;
  }

  get<T>(key: ExtensionKey<T>): T {
    if (!this.values.has(key.name)) {
      throw new ShardError("config", `Extension "${key.name}" is not available in ${this.modulePath}`,
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

export interface ModuleInit {
  readonly name: string;
  /** ":" for the root, ":lib" for others. */
  readonly path: string;
  readonly dir: string;
  readonly buildDir: string;
  /** The file the module's config was read from; undefined when it has none. */
  readonly configFile?: string;
}

/** What a module gets from the build it belongs to. */
export interface ModuleServices {
  readonly onRegister: (task: TaskProvider<Task>) => void;
  readonly resolution: ResolutionServices;
  readonly services: ServiceRegistry;
  /** Directory of the root module: where build-wide state lives. */
  readonly rootDir: string;
  readonly warn: (module: Module, message: string) => void;
  readonly report: (module: Module, event: unknown) => void;
}

/**
 * One module of the build. A module holds registries and nothing else; it
 * has no way to reach other modules, so they exchange data only through
 * consumable configurations.
 */
export class Module {
  readonly name: string;
  readonly path: string;
  readonly dir: string;
  readonly buildDir: string;
  readonly configFile: string | undefined;
  readonly tasks: TaskContainer;
  readonly extensions: ExtensionContainer;
  readonly plugins: PluginContainer;
  readonly configurations: ConfigurationContainer;
  /** Build-wide services: the toolchain, run parameters. */
  readonly services: ServiceRegistry;
  /** Build-wide attribute rules; a plugin defines the attributes it introduces once. */
  readonly schema: AttributeSchema;
  readonly rootDir: string;
  private readonly configuredActions: (() => void)[] = [];
  private readonly warnSink: (module: Module, message: string) => void;
  private readonly reportSink: (module: Module, event: unknown) => void;

  constructor(init: ModuleInit, services: ModuleServices) {
    this.name = init.name;
    this.path = init.path;
    this.dir = init.dir;
    this.buildDir = init.buildDir;
    this.configFile = init.configFile;
    this.tasks = new TaskContainer(init.path, init.dir, init.buildDir, services.onRegister);
    this.configurations = new ConfigurationContainer(init.path, services.resolution);
    this.extensions = new ExtensionContainer(init.path);
    this.services = services.services;
    this.schema = services.resolution.schema;
    this.warnSink = services.warn;
    this.reportSink = services.report;
    this.rootDir = services.rootDir;
    this.plugins = new PluginContainer(this);
  }

  /** A warning for the user, e.g. "static linking unavailable on macOS". */
  warn(message: string): void {
    this.warnSink(this, message);
  }

  /** Something for the user's report outside any task, e.g. a preload hook's run. */
  report(event: unknown): void {
    this.reportSink(this, event);
  }

  /**
   * Side effects that must happen once configuration is over and before the
   * task graph is built, such as a `preload` hook generating sources. Runs
   * for each module after the modules it depends on. Not a way to change
   * configuration: properties may already have been read.
   */
  onConfigured(action: () => void): void {
    this.configuredActions.push(action);
  }

  /** Called by the build once, in dependency order. */
  runConfigured(): void {
    for (const action of this.configuredActions.splice(0)) action();
  }
}
