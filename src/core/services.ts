import { ShardError } from "../utils/errors";

/** A typed handle for a build-wide service: `const TOOLCHAIN = service<Toolchain>("toolchain")`. */
export interface ServiceKey<T> {
  readonly name: string;
  /** Type marker only. */
  readonly _type?: T;
}

export function service<T>(name: string): ServiceKey<T> {
  return { name };
}

/**
 * Shared by every module of one build: the toolchain, run parameters from the
 * command line. Registered by plugins or the CLI, read by tasks' configuration.
 */
export class ServiceRegistry {
  private readonly values = new Map<string, unknown>();
  private readonly pending = new Map<string, () => unknown>();

  register<T>(key: ServiceKey<T>, value: T): T {
    if (this.has(key)) throw new ShardError("config", `Service "${key.name}" is already registered`);
    this.values.set(key.name, value);
    return value;
  }

  /** Registers on first call; later calls return what is there. */
  getOrRegister<T>(key: ServiceKey<T>, create: () => T): T {
    if (!this.has(key)) this.values.set(key.name, create());
    return this.get(key);
  }

  /**
   * Offers a service created on first use, unless one is already there: a
   * toolchain is detected only by commands that compile or resolve.
   */
  provideLazily<T>(key: ServiceKey<T>, create: () => T): void {
    if (!this.has(key)) this.pending.set(key.name, create);
  }

  has(key: ServiceKey<unknown>): boolean {
    return this.values.has(key.name) || this.pending.has(key.name);
  }

  get<T>(key: ServiceKey<T>, hint?: string): T {
    const value = this.find(key);
    if (value === undefined) throw new ShardError("config", `Service "${key.name}" is not available`, hint);
    return value;
  }

  find<T>(key: ServiceKey<T>): T | undefined {
    const create = this.pending.get(key.name);
    if (create) {
      this.pending.delete(key.name);
      this.values.set(key.name, create());
    }
    return this.values.get(key.name) as T | undefined;
  }
}
