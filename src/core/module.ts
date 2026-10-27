import { ShardError } from "../utils/errors";
import type { AttributeSchema } from "./attributes";
import { ConfigurationContainer } from "./configurations";
import type { ResolutionServices } from "./resolution";
import type { ServiceRegistry } from "./services";
import { TaskContainer, type TaskProvider } from "./tasks";
import type { Task } from "./task";

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

  withId(id: string, action: (plugin: Plugin) => void): void {
    const plugin = this.applied.get(id);
    if (plugin) action(plugin);
    else this.waiting.set(id, [...(this.waiting.get(id) ?? []), action]);
  }
}

export interface ExtensionKey<T> {
  readonly name: string;
  readonly _type?: T;
}

export function extension<T>(name: string): ExtensionKey<T> {
  return { name };
}

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
  readonly path: string;
  readonly dir: string;
  readonly buildDir: string;
  readonly configFile?: string;
}

export interface ModuleServices {
  readonly onRegister: (task: TaskProvider<Task>) => void;
  readonly resolution: ResolutionServices;
  readonly services: ServiceRegistry;
  readonly rootDir: string;
  readonly warn: (module: Module, message: string) => void;
  readonly report: (module: Module, event: unknown) => void;
}

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
  readonly services: ServiceRegistry;
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

  warn(message: string): void {
    this.warnSink(this, message);
  }

  report(event: unknown): void {
    this.reportSink(this, event);
  }

  onConfigured(action: () => void): void {
    this.configuredActions.push(action);
  }

  runConfigured(): void {
    for (const action of this.configuredActions.splice(0)) action();
  }
}
