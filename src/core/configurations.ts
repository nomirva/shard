import { ShardError } from "../utils/errors";
import { AttributeContainer, type Attribute } from "./attributes";
import { ListProperty, type Provider } from "./provider";
import { ResolutionResult, type ResolutionServices } from "./resolution";

export interface Artifact {
  readonly type: string;
  readonly value: string;
}

export type Dependency =
  | {
      readonly kind: "module";
      readonly path: string;
      readonly attributes: AttributeContainer;
    }
  | {
      readonly kind: "variants";
      readonly name: string;
      readonly variants: readonly OutgoingVariant[];
      readonly attributes: AttributeContainer;
    };

export function moduleDependency(path: string, attributes = AttributeContainer.empty()): Dependency {
  return { kind: "module", path, attributes };
}

export interface OutgoingVariant {
  readonly name: string;
  readonly attributes: AttributeContainer;
  readonly artifacts: Provider<Artifact[]>;
  readonly dependencies: readonly Dependency[];
}

export type ConfigurationRole = "scope" | "resolvable" | "consumable";

export class Configuration {
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

  extendsFrom(...scopes: Configuration[]): this {
    this.checkOpen();
    this.parents.push(...scopes);
    return this;
  }

  declaredDependencies(): readonly Dependency[] {
    return this.declared;
  }

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

  asVariant(): OutgoingVariant {
    if (this.role !== "consumable") throw new ShardError("config", `${this.path} is not consumable`);
    return { name: this.name, attributes: this.attrs, artifacts: this.artifacts, dependencies: this.allDependencies() };
  }

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

  all(): Configuration[] {
    return [...this.configurations.values()];
  }

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
