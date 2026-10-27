import { ShardError } from "../utils/errors";

export interface ServiceKey<T> {
  readonly name: string;
  readonly _type?: T;
}

export function service<T>(name: string): ServiceKey<T> {
  return { name };
}

export class ServiceRegistry {
  private readonly values = new Map<string, unknown>();
  private readonly pending = new Map<string, () => unknown>();

  register<T>(key: ServiceKey<T>, value: T): T {
    if (this.has(key)) throw new ShardError("config", `Service "${key.name}" is already registered`);
    this.values.set(key.name, value);
    return value;
  }

  getOrRegister<T>(key: ServiceKey<T>, create: () => T): T {
    if (!this.has(key)) this.values.set(key.name, create());
    return this.get(key);
  }

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
