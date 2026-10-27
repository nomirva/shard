import { ShardError } from "../utils/errors";

export interface Producer {
  readonly path: string;
}

export abstract class Provider<T> {
  abstract get(): T;
  abstract isPresent(): boolean;
  abstract producers(): readonly Producer[];

  getOrElse(fallback: T): T {
    return this.isPresent() ? this.get() : fallback;
  }

  map<U>(fn: (value: T) => U): Provider<U> {
    return new Derived(() => fn(this.get()), () => this.isPresent(), () => this.producers());
  }

  flatMap<U>(fn: (value: T) => Provider<U>): Provider<U> {
    return new Derived(
      () => fn(this.get()).get(),
      () => this.isPresent() && fn(this.get()).isPresent(),
      () => union(this.producers(), this.isPresent() ? fn(this.get()).producers() : []),
    );
  }

  zip<U, R>(other: Provider<U>, fn: (a: T, b: U) => R): Provider<R> {
    return new Derived(
      () => fn(this.get(), other.get()),
      () => this.isPresent() && other.isPresent(),
      () => union(this.producers(), other.producers()),
    );
  }
}

class Derived<T> extends Provider<T> {
  constructor(
    private readonly value: () => T,
    private readonly present: () => boolean,
    private readonly from: () => readonly Producer[],
  ) {
    super();
  }

  get(): T {
    return this.value();
  }

  isPresent(): boolean {
    return this.present();
  }

  producers(): readonly Producer[] {
    return this.from();
  }
}

export function provider<T>(value: T): Provider<T> {
  return new Derived(() => value, () => true, () => []);
}

export function lazy<T>(fn: () => T): Provider<T> {
  let cached: { value: T } | null = null;
  return new Derived(() => (cached ??= { value: fn() }).value, () => true, () => []);
}

export type ValueOrProvider<T> = T | Provider<T>;

const asProvider = <T>(v: ValueOrProvider<T>): Provider<T> => (v instanceof Provider ? v : provider(v));

export class Property<T> extends Provider<T> {
  private source: Provider<T> | null = null;
  private fallback: Provider<T> | null = null;
  private final: { value: T } | null = null;
  private frozen = false;
  private upstream: readonly Producer[] = [];

  constructor(protected readonly owner: string, private readonly producer?: Producer) {
    super();
  }

  set(value: ValueOrProvider<T>): this {
    this.checkMutable();
    this.source = asProvider(value);
    return this;
  }

  convention(value: ValueOrProvider<T>): this {
    this.checkMutable();
    this.fallback = asProvider(value);
    return this;
  }

  get(): T {
    if (this.final) return this.final.value;
    const current = this.current();
    if (!current) throw new ShardError("config", `${this.owner} has no value`);
    return current.get();
  }

  isPresent(): boolean {
    return this.final !== null || (this.current()?.isPresent() ?? false);
  }

  producers(): readonly Producer[] {
    const upstream = this.frozen ? this.upstream : this.current()?.producers() ?? [];
    return this.producer ? union([this.producer], upstream) : upstream;
  }

  finalizeValue(): void {
    if (this.final) return;
    this.upstream = this.current()?.producers() ?? [];
    if (this.isPresent()) this.final = { value: this.get() };
    this.source = this.fallback = null;
    this.frozen = true;
  }

  private current(): Provider<T> | null {
    if (this.source?.isPresent()) return this.source;
    return this.fallback ?? this.source;
  }

  private checkMutable(): void {
    if (this.frozen) throw new ShardError("config", `${this.owner} is final and can no longer be changed`);
  }
}

export class ListProperty<T> extends Provider<T[]> {
  private items: Provider<readonly T[]>[] = [];
  private fallback: Provider<readonly T[]> | null = null;
  private final: T[] | null = null;
  private explicit = false;
  private frozen = false;
  private upstream: readonly Producer[] = [];

  constructor(protected readonly owner: string, private readonly producer?: Producer) {
    super();
  }

  add(item: ValueOrProvider<T>): this {
    this.checkMutable();
    this.items.push(item instanceof Provider ? item.map(v => [v]) : provider([item]));
    this.explicit = true;
    return this;
  }

  addAll(items: ValueOrProvider<readonly T[]>): this {
    this.checkMutable();
    this.items.push(asProvider(items));
    this.explicit = true;
    return this;
  }

  set(items: ValueOrProvider<readonly T[]>): this {
    this.checkMutable();
    this.items = [asProvider(items)];
    this.explicit = true;
    return this;
  }

  convention(items: ValueOrProvider<readonly T[]>): this {
    this.checkMutable();
    this.fallback = asProvider(items);
    return this;
  }

  get(): T[] {
    if (this.final) return [...this.final];
    return this.sources().flatMap(p => (p.isPresent() ? [...p.get()] : []));
  }

  isPresent(): boolean {
    return true;
  }

  producers(): readonly Producer[] {
    const upstream = this.frozen
      ? this.upstream
      : this.sources().reduce<readonly Producer[]>((all, p) => union(all, p.producers()), []);
    return this.producer ? union([this.producer], upstream) : upstream;
  }

  finalizeValue(): void {
    if (this.final) return;
    this.upstream = this.producers().filter(p => p !== this.producer);
    this.final = this.get();
    this.items = [];
    this.fallback = null;
    this.frozen = true;
  }

  private sources(): Provider<readonly T[]>[] {
    if (this.explicit) return this.items;
    return this.fallback ? [this.fallback] : [];
  }

  private checkMutable(): void {
    if (this.frozen) throw new ShardError("config", `${this.owner} is final and can no longer be changed`);
  }
}

function union(a: readonly Producer[], b: readonly Producer[]): readonly Producer[] {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out = [...a];
  for (const p of b) if (!out.some(x => x.path === p.path)) out.push(p);
  return out;
}
