import { ListProperty, Property, Provider, type Producer } from "./provider";

export interface TaskScope {
  readonly name: string;
  readonly path: string;
  readonly modulePath: string;
  readonly moduleDir: string;
  readonly buildDir: string;
}

export interface TaskContext {
  discovered(files: readonly string[]): void;
  progress(done: number, total: number, current?: string): void;
  readonly state: TaskState;
  report(event: unknown): void;
}

export interface TaskState {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export type InputKind = "value" | "files";

export interface DeclaredInput {
  readonly name: string;
  readonly kind: InputKind;
  readonly value: Provider<unknown>;
}

export interface DeclaredOutput {
  readonly name: string;
  readonly files: Provider<string | string[]>;
}

export abstract class Task implements Producer {
  readonly name: string;
  readonly path: string;
  readonly modulePath: string;
  readonly moduleDir: string;
  readonly buildDir: string;
  description = "";
  alwaysRun = false;
  finalizeOnSuccessOnly = false;

  readonly #inputs: DeclaredInput[] = [];
  readonly #outputs: DeclaredOutput[] = [];
  readonly #explicitDeps: (Producer | Provider<unknown>)[] = [];
  readonly #finalizers: Producer[] = [];

  constructor(scope: TaskScope) {
    this.name = scope.name;
    this.path = scope.path;
    this.modulePath = scope.modulePath;
    this.moduleDir = scope.moduleDir;
    this.buildDir = scope.buildDir;
  }

  abstract run(ctx: TaskContext): void | Promise<void>;

  dependsOn(...deps: (Producer | Provider<unknown>)[]): this {
    this.#explicitDeps.push(...deps);
    return this;
  }

  finalizedBy(...finalizer: Producer[]): this {
    this.#finalizers.push(...finalizer);
    return this;
  }

  declaredInputs(): readonly DeclaredInput[] {
    return this.#inputs;
  }

  declaredOutputs(): readonly DeclaredOutput[] {
    return this.#outputs;
  }

  dependencies(): readonly Producer[] {
    const out: Producer[] = [];
    const add = (p: Producer): void => {
      if (p.path !== this.path && !out.some(x => x.path === p.path)) out.push(p);
    };
    for (const dep of this.#explicitDeps) {
      if (dep instanceof Provider) dep.producers().forEach(add);
      else add(dep);
    }
    for (const input of this.#inputs) input.value.producers().forEach(add);
    return out;
  }

  finalizedByTasks(): readonly Producer[] {
    return this.#finalizers;
  }

  finalizeProperties(): void {
    for (const p of [...this.#inputs.map(i => i.value), ...this.#outputs.map(o => o.files)]) {
      if (p instanceof Property || p instanceof ListProperty) p.finalizeValue();
    }
  }

  protected input<T>(name: string): Property<T> {
    const property = new Property<T>(`${this.path}.${name}`);
    this.#inputs.push({ name, kind: "value", value: property });
    return property;
  }

  protected inputList<T>(name: string): ListProperty<T> {
    const property = new ListProperty<T>(`${this.path}.${name}`);
    this.#inputs.push({ name, kind: "value", value: property });
    return property;
  }

  protected inputFiles(name: string): ListProperty<string> {
    const property = new ListProperty<string>(`${this.path}.${name}`);
    this.#inputs.push({ name, kind: "files", value: property });
    return property;
  }

  protected outputFile(name: string): Property<string> {
    const property = new Property<string>(`${this.path}.${name}`, this);
    this.#outputs.push({ name, files: property });
    return property;
  }

  protected outputFiles(name: string): ListProperty<string> {
    const property = new ListProperty<string>(`${this.path}.${name}`, this);
    this.#outputs.push({ name, files: property });
    return property;
  }
}

export type TaskType<T extends Task> = new (scope: TaskScope) => T;

export type TaskClass<T extends Task> = abstract new (scope: TaskScope) => T;
