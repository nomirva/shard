import { ShardError } from "../utils/errors";
import { Provider, type Producer } from "./provider";
import type { Task, TaskClass, TaskScope, TaskType } from "./task";

export class TaskProvider<T extends Task> extends Provider<T> implements Producer {
  private task: T | null = null;
  private readonly actions: ((task: T) => void)[] = [];

  constructor(
    readonly name: string,
    readonly path: string,
    readonly type: TaskType<T>,
    private readonly create: (provider: TaskProvider<T>) => T,
  ) {
    super();
  }

  configure(action: (task: T) => void): this {
    if (this.task) action(this.task);
    else this.actions.push(action);
    return this;
  }

  get(): T {
    if (!this.task) {
      this.task = this.create(this);
      for (const action of this.actions.splice(0)) action(this.task);
    }
    return this.task;
  }

  isRealized(): boolean {
    return this.task !== null;
  }

  isPresent(): boolean {
    return true;
  }

  producers(): readonly Producer[] {
    return [this];
  }
}

interface TypeAction {
  readonly type: TaskClass<Task>;
  readonly action: (task: Task) => void;
}

export class TaskContainer {
  private readonly tasks = new Map<string, TaskProvider<Task>>();
  private readonly typeActions: TypeAction[] = [];

  constructor(
    private readonly modulePath: string,
    private readonly moduleDir: string,
    private readonly buildDir: string,
    private readonly onRegister: (task: TaskProvider<Task>) => void,
  ) {}

  register<T extends Task>(name: string, type: TaskType<T>, configure?: (task: T) => void): TaskProvider<T> {
    if (this.tasks.has(name)) {
      throw new ShardError("config", `Task "${name}" is already registered in ${this.modulePath}`);
    }
    const path = this.modulePath === ":" ? `:${name}` : `${this.modulePath}:${name}`;
    const scope: TaskScope = { name, path, modulePath: this.modulePath, moduleDir: this.moduleDir, buildDir: this.buildDir };
    const provider = new TaskProvider<T>(name, path, type, () => {
      const task = new type(scope);
      for (const { type: wanted, action } of this.typeActions) {
        if (task instanceof wanted) action(task);
      }
      return task;
    });
    if (configure) provider.configure(configure);
    this.tasks.set(name, provider as unknown as TaskProvider<Task>);
    this.onRegister(provider as unknown as TaskProvider<Task>);
    return provider;
  }

  named(name: string): TaskProvider<Task> {
    const task = this.tasks.get(name);
    if (!task) {
      throw new ShardError("config", `Task "${name}" not found in ${this.modulePath}`, undefined, {
        details: [["available", [...this.tasks.keys()].join(", ") || "(none)"]],
      });
    }
    return task;
  }

  findByName(name: string): TaskProvider<Task> | undefined {
    return this.tasks.get(name);
  }

  names(): string[] {
    return [...this.tasks.keys()];
  }

  configureEach<T extends Task>(type: TaskClass<T>, action: (task: T) => void): void {
    this.typeActions.push({ type, action: action as (task: Task) => void });
    for (const provider of this.tasks.values()) {
      if (provider.isRealized() && provider.get() instanceof type) action(provider.get() as T);
    }
  }
}
