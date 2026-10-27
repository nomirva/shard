import { ShardError } from "../utils/errors";

export interface Attribute<T> {
  readonly name: string;
  readonly _type?: T;
}

export function attribute<T>(name: string): Attribute<T> {
  return { name };
}

export class AttributeContainer {
  private constructor(private readonly values: ReadonlyMap<string, unknown>) {}

  static empty(): AttributeContainer {
    return new AttributeContainer(new Map());
  }

  static of(entries: readonly (readonly [Attribute<unknown>, unknown])[]): AttributeContainer {
    return new AttributeContainer(new Map(entries.map(([a, v]) => [a.name, v])));
  }

  with<T>(attr: Attribute<T>, value: T): AttributeContainer {
    return new AttributeContainer(new Map([...this.values, [attr.name, value]]));
  }

  merge(other: AttributeContainer): AttributeContainer {
    return new AttributeContainer(new Map([...this.values, ...other.values]));
  }

  get<T>(attr: Attribute<T>): T | undefined {
    return this.values.get(attr.name) as T | undefined;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  names(): string[] {
    return [...this.values.keys()];
  }

  raw(name: string): unknown {
    return this.values.get(name);
  }

  isEmpty(): boolean {
    return this.values.size === 0;
  }

  describe(): string {
    return [...this.values].map(([k, v]) => `${k}=${String(v)}`).join(", ") || "(no attributes)";
  }
}

export type CompatibilityRule<T> = (requested: T, produced: T) => boolean;

export type DisambiguationRule<T> = (requested: T | undefined, candidates: readonly T[]) => readonly T[];

export type UnificationRule<T> = (requested: readonly T[]) => T;

interface AttributeRules {
  compatible: CompatibilityRule<unknown>;
  disambiguate?: DisambiguationRule<unknown>;
  unify?: UnificationRule<unknown>;
}

export class AttributeSchema {
  private readonly rules = new Map<string, AttributeRules>();

  define<T>(
    attr: Attribute<T>,
    rules: { compatible?: CompatibilityRule<T>; disambiguate?: DisambiguationRule<T>; unify?: UnificationRule<T> } = {},
  ): void {
    if (this.rules.has(attr.name)) throw new ShardError("config", `Attribute "${attr.name}" is already defined`);
    this.rules.set(attr.name, {
      compatible: (rules.compatible ?? Object.is) as CompatibilityRule<unknown>,
      disambiguate: rules.disambiguate as DisambiguationRule<unknown> | undefined,
      unify: rules.unify as UnificationRule<unknown> | undefined,
    });
  }

  unifyRequest(requested: AttributeContainer, buildWide: readonly AttributeContainer[]): AttributeContainer {
    let out = requested;
    for (const [name, rules] of this.rules) {
      if (!rules.unify) continue;
      const values = buildWide.filter(r => r.has(name)).map(r => r.raw(name));
      if (values.length > 0) out = out.with(attribute(name), rules.unify(values));
    }
    return out;
  }

  isDefined(attr: Attribute<unknown>): boolean {
    return this.rules.has(attr.name);
  }

  matches(requested: AttributeContainer, produced: AttributeContainer): boolean {
    return requested.names().every(name => {
      if (!produced.has(name)) return true;
      const compatible = this.rules.get(name)?.compatible ?? Object.is;
      return compatible(requested.raw(name), produced.raw(name));
    });
  }

  disambiguate<C>(requested: AttributeContainer, candidates: readonly C[], attributesOf: (c: C) => AttributeContainer): C[] {
    let remaining = [...candidates];
    const names = [...new Set(remaining.flatMap(c => attributesOf(c).names()))].sort();
    for (const name of names) {
      if (remaining.length <= 1) break;
      const rule = this.rules.get(name)?.disambiguate;
      if (!rule) continue;
      const offered = remaining.filter(c => attributesOf(c).has(name)).map(c => attributesOf(c).raw(name));
      const keep = rule(requested.raw(name), offered);
      if (keep.length === 0) continue;
      const narrowed = remaining.filter(c => !attributesOf(c).has(name) || keep.some(v => Object.is(v, attributesOf(c).raw(name))));
      if (narrowed.length > 0) remaining = narrowed;
    }
    if (remaining.length > 1) {
      const extra = (c: C) => attributesOf(c).names().filter(n => !requested.has(n)).length;
      const fewest = Math.min(...remaining.map(extra));
      remaining = remaining.filter(c => extra(c) === fewest);
    }
    return remaining;
  }
}
