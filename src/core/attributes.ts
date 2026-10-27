import { ShardError } from "../utils/errors";

/** A typed axis of a variant, e.g. `attribute<string>("shard.linkage")`. */
export interface Attribute<T> {
  readonly name: string;
  /** Type marker only. */
  readonly _type?: T;
}

export function attribute<T>(name: string): Attribute<T> {
  return { name };
}

/** Attribute values of one variant or of one request. Immutable: `with` returns a copy. */
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

  /** `other` wins where both have a value. */
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

  /** "linkage=static, profile=release" for error messages and `--print-graph`. */
  describe(): string {
    return [...this.values].map(([k, v]) => `${k}=${String(v)}`).join(", ") || "(no attributes)";
  }
}

/** May a producer offering `produced` serve a consumer asking for `requested`? Default: equality. */
export type CompatibilityRule<T> = (requested: T, produced: T) => boolean;

/**
 * Several producer variants are compatible: keep the best ones. Gets the
 * requested value (undefined when the consumer did not ask) and the values
 * the remaining candidates offer.
 */
export type DisambiguationRule<T> = (requested: T | undefined, candidates: readonly T[]) => readonly T[];

interface AttributeRules {
  compatible: CompatibilityRule<unknown>;
  disambiguate?: DisambiguationRule<unknown>;
}

/**
 * How attributes are matched, shared by the whole build. Plugins register
 * rules for the attributes they define; unknown attributes match by equality.
 */
export class AttributeSchema {
  private readonly rules = new Map<string, AttributeRules>();

  define<T>(attr: Attribute<T>, rules: { compatible?: CompatibilityRule<T>; disambiguate?: DisambiguationRule<T> } = {}): void {
    if (this.rules.has(attr.name)) throw new ShardError("config", `Attribute "${attr.name}" is already defined`);
    this.rules.set(attr.name, {
      compatible: (rules.compatible ?? Object.is) as CompatibilityRule<unknown>,
      disambiguate: rules.disambiguate as DisambiguationRule<unknown> | undefined,
    });
  }

  /** Every requested attribute the producer also has must be compatible; missing ones do not matter. */
  matches(requested: AttributeContainer, produced: AttributeContainer): boolean {
    return requested.names().every(name => {
      if (!produced.has(name)) return true;
      const compatible = this.rules.get(name)?.compatible ?? Object.is;
      return compatible(requested.raw(name), produced.raw(name));
    });
  }

  /**
   * Narrows compatible candidates attribute by attribute with the registered
   * rules, then prefers candidates that carry no attributes beyond the
   * request. Returns what is left (one entry when the choice is clear).
   */
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
