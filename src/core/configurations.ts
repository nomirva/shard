import { ShardError } from "../utils/errors";
import { AttributeContainer, type Attribute } from "./attributes";
import { ListProperty, type Provider } from "./provider";
import { ResolutionResult, type ResolutionServices } from "./resolution";

/** One published thing: a file (headers dir, `.a`, `.so`) or a value such as a link flag. */
export interface Artifact {
  /** What the consumer does with it, e.g. "include-dir", "static-lib", "link-flag". */
  readonly type: string;
  readonly value: string;
}

/**
 * A request for something another party publishes. `attributes` refine the
 * consumer's request for this edge only, e.g. linkage=shared for "lib+shared".
 */
export type Dependency =
  | {
      readonly kind: "project";
      /** Project path in this build, e.g. ":lib". */
      readonly path: string;
      readonly attributes: AttributeContainer;
    }
  | {
      /** Published by a plugin without a project behind it: a system library, a prebuilt file. */
      readonly kind: "variants";
      readonly name: string;
      readonly variants: readonly OutgoingVariant[];
      readonly attributes: AttributeContainer;
    };

export function projectDependency(path: string, attributes = AttributeContainer.empty()): Dependency {
  return { kind: "project", path, attributes };
}

/** A variant a dependency can be satisfied with. */
export interface OutgoingVariant {
  readonly name: string;
  readonly attributes: AttributeContainer;
  readonly artifacts: Provider<Artifact[]>;
  /** Dependencies consumers inherit (`api`-like scopes). */
  readonly dependencies: readonly Dependency[];
}

/**
 * - `scope`: dependencies are declared here (`implementation`, `api`);
 * - `resolvable`: a consumer's view (`compileClasspath`), resolved against producers;
 * - `consumable`: a variant this project publishes (`linkElements`).
 */
export type ConfigurationRole = "scope" | "resolvable" | "consumable";

export class Configuration {
  /** ":app:linkClasspath", or ":linkClasspath" in the root project. */
  readonly path: string;
  readonly artifacts: ListProperty<Artifact>;
  private attrs = AttributeContainer.empty();
  private readonly declared: Dependency[] = [];
  private readonly parents: Configuration[] = [];
  private result: ResolutionResult | null = null;

  constructor(
    readonly name: string,
    readonly role: ConfigurationRole,
    readonly owner: string,
    private readonly services: ResolutionServices,
  ) {
    this.path = owner === ":" ? `:${name}` : `${owner}:${name}`;
    this.artifacts = new ListProperty<Artifact>(`${this.path}.artifacts`);
  }

  attribute<T>(attr: Attribute<T>, value: T): this {
    this.checkOpen();
    this.attrs = this.attrs.with(attr, value);
    return this;
  }

  get attributes(): AttributeContainer {
    return this.attrs;
  }

  add(dependency: Dependency): this {
    this.checkOpen();
    this.declared.push(dependency);
    return this;
  }

  /** Inherits every dependency of `scopes`, e.g. compileClasspath extends implementation and api. */
  extendsFrom(...scopes: Configuration[]): this {
    this.checkOpen();
    this.parents.push(...scopes);
    return this;
  }

  /** Own and inherited dependencies, in declaration order. */
  allDependencies(): Dependency[] {
    const out: Dependency[] = [];
    const seen = new Set<Configuration>();
    const walk = (c: Configuration): void => {
      if (seen.has(c)) return;
      seen.add(c);
      out.push(...c.declared);
      c.parents.forEach(walk);
    };
    walk(this);
    return out;
  }

  /** The variant this configuration publishes; only for consumable ones. */
  asVariant(): OutgoingVariant {
    if (this.role !== "consumable") throw new ShardError("config", `${this.path} is not consumable`);
    return { name: this.name, attributes: this.attrs, artifacts: this.artifacts, dependencies: this.allDependencies() };
  }

  /** Resolved on first use, after configuration is over; only for resolvable ones. */
  get incoming(): ResolutionResult {
    if (this.role !== "resolvable") throw new ShardError("config", `${this.path} is not resolvable`);
    this.result ??= new ResolutionResult(`${this.path}`, this.attrs, this.allDependencies(), this.services);
    return this.result;
  }

  private checkOpen(): void {
    if (this.result?.isResolved()) {
      throw new ShardError("config", `${this.path} was already resolved and can no longer be changed`);
    }
  }
}

export class ConfigurationContainer {
  private readonly configurations = new Map<string, Configuration>();

  constructor(private readonly owner: string, private readonly services: ResolutionServices) {}

  scope(name: string): Configuration {
    return this.create(name, "scope");
  }

  resolvable(name: string): Configuration {
    return this.create(name, "resolvable");
  }

  consumable(name: string): Configuration {
    return this.create(name, "consumable");
  }

  named(name: string): Configuration {
    const c = this.configurations.get(name);
    if (!c) throw new ShardError("config", `Configuration "${name}" not found in ${this.owner}`);
    return c;
  }

  findByName(name: string): Configuration | undefined {
    return this.configurations.get(name);
  }

  /** Variants other projects can resolve against. */
  consumableVariants(): OutgoingVariant[] {
    return [...this.configurations.values()].filter(c => c.role === "consumable").map(c => c.asVariant());
  }

  private create(name: string, role: ConfigurationRole): Configuration {
    if (this.configurations.has(name)) {
      throw new ShardError("config", `Configuration "${name}" already exists in ${this.owner}`);
    }
    const c = new Configuration(name, role, this.owner, this.services);
    this.configurations.set(name, c);
    return c;
  }
}
