import { ListProperty, Property, Provider, type Producer } from "./provider";

/**
 * What a task knows about where it lives. Deliberately not the Module: an
 * action that cannot reach the module only depends on its own properties,
 * which is what makes the task graph cacheable and safe to run in parallel.
 */
export interface TaskScope {
  readonly name: string;
  /** ":app:compile" — unique across the whole build. */
  readonly path: string;
  /** ":app", or ":" for the root module. */
  readonly modulePath: string;
  readonly moduleDir: string;
  /** Per-module directory for outputs, e.g. "<module>/.shard". */
  readonly buildDir: string;
}

/** Handed to a running action. */
export interface TaskContext {
  /**
   * Input files found while running (headers from a depfile). They are
   * fingerprinted on the next run along with the declared inputs.
   */
  discovered(files: readonly string[]): void;
  /** Progress within the task, e.g. files compiled out of total. */
  progress(done: number, total: number, current?: string): void;
  /**
   * State kept between runs of this task, for incremental work inside one
   * task (which files of a compile task are still fresh).
   */
  readonly state: TaskState;
  /** Something for the user's report (a file compiled, a hook's output); passed on as is. */
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

/**
 * A unit of work. Subclasses declare inputs and outputs as properties in field
 * initializers and implement `run`:
 *
 *   class Touch extends Task {
 *     readonly text = this.input<string>("text");
 *     readonly file = this.outputFile("file");
 *     run() { writeFileSync(this.file.get(), this.text.get()); }
 *   }
 *
 * Declared inputs decide whether the task is up to date; reading another
 * task's output property in an input is what orders the two tasks.
 */
export abstract class Task implements Producer {
  readonly name: string;
  readonly path: string;
  readonly modulePath: string;
  readonly moduleDir: string;
  readonly buildDir: string;
  description = "";
  /** A task without outputs, or with this set, runs every time. */
  alwaysRun = false;
  /**
   * As a finalizer: run only when every task it finalizes succeeded (a
   * post-build hook), instead of whenever one of them ran (a cleanup).
   */
  finalizeOnSuccessOnly = false;

  // ES private fields: a task type may name its own properties `inputs` or `outputs`.
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

  /** Orders this task after `deps` without passing data; prefer wiring outputs into inputs. */
  dependsOn(...deps: (Producer | Provider<unknown>)[]): this {
    this.#explicitDeps.push(...deps);
    return this;
  }

  /** `finalizer` runs after this task whenever this task ran, even if it failed. */
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

  /** Every task this one must run after: explicit deps and producers of its inputs. */
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

  /** Freezes every declared property; called once the task is in the graph. */
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

  /** Files whose contents are inputs; directories are walked. */
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

/** Any task class, abstract ones included: what `configureEach` matches on. */
export type TaskClass<T extends Task> = abstract new (scope: TaskScope) => T;
