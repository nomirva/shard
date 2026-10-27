import { ShardError } from "../utils/errors";
import type { AttributeContainer, AttributeSchema } from "./attributes";
import type { Artifact, Dependency, OutgoingVariant } from "./configurations";
import { Provider, type Producer } from "./provider";

/** What resolution needs from the build: matching rules and the variants each project publishes. */
export interface ResolutionServices {
  readonly schema: AttributeSchema;
  /** Undefined when no such project takes part in the build. */
  variantsOf(projectPath: string): readonly OutgoingVariant[] | undefined;
}

/** One chosen variant in the resolved graph. */
export interface ResolvedNode {
  /** Project path, or the dependency's name for plugin-published variants. */
  readonly owner: string;
  readonly variant: OutgoingVariant;
  readonly dependencies: readonly ResolvedNode[];
}

/**
 * The resolved dependency graph of one resolvable configuration. Computed on
 * first use, so dependencies declared at any point during configuration count.
 */
export class ResolutionResult {
  private resolved: { roots: ResolvedNode[]; order: ResolvedNode[] } | null = null;

  constructor(
    private readonly name: string,
    private readonly request: AttributeContainer,
    private readonly dependencies: readonly Dependency[],
    private readonly services: ResolutionServices,
  ) {}

  isResolved(): boolean {
    return this.resolved !== null;
  }

  /** Direct dependencies as chosen variants, each with its own dependencies. */
  roots(): readonly ResolvedNode[] {
    return this.resolve().roots;
  }

  /**
   * Every chosen variant once, each before the variants it depends on — the
   * order a static linker needs.
   */
  nodes(): readonly ResolvedNode[] {
    return this.resolve().order;
  }

  /** Artifacts of all chosen variants in `nodes()` order, optionally of one type; tracks their producers. */
  artifacts(type?: string): Provider<Artifact[]> {
    return new ArtifactsProvider(() => this.nodes(), type);
  }

  private resolve(): { roots: ResolvedNode[]; order: ResolvedNode[] } {
    if (this.resolved) return this.resolved;
    const memo = new Map<string, ResolvedNode>();
    const stack: string[] = [];

    const visit = (dep: Dependency): ResolvedNode => {
      const owner = dep.kind === "project" ? dep.path : dep.name;
      const requested = this.request.merge(dep.attributes);
      const variant = this.choose(owner, dep, requested);
      const key = `${owner}#${variant.name}`;
      const known = memo.get(key);
      if (known) return known;
      if (stack.includes(key)) {
        throw new ShardError("config", "Dependency cycle", undefined, {
          details: [["cycle", [...stack.slice(stack.indexOf(key)), key].map(k => k.split("#")[0]).join(" → ")]],
        });
      }
      stack.push(key);
      const node: ResolvedNode = { owner, variant, dependencies: variant.dependencies.map(visit) };
      stack.pop();
      memo.set(key, node);
      return node;
    };

    const roots = this.dependencies.map(visit);
    this.resolved = { roots, order: consumerFirst(roots) };
    return this.resolved;
  }

  private choose(owner: string, dep: Dependency, requested: AttributeContainer): OutgoingVariant {
    const candidates = dep.kind === "project" ? this.services.variantsOf(dep.path) : dep.variants;
    if (!candidates) {
      throw new ShardError("config", `${this.name} depends on ${owner}, which is not part of the build`);
    }
    const { schema } = this.services;
    const compatible = candidates.filter(v => schema.matches(requested, v.attributes));
    const chosen = schema.disambiguate(requested, compatible, v => v.attributes);
    if (chosen.length === 1) return chosen[0]!;

    const offered = (compatible.length > 0 ? chosen : candidates)
      .map((v): [string, string] => [v.name, v.attributes.describe()]);
    if (compatible.length === 0) {
      throw new ShardError("config", `No variant of ${owner} matches what ${this.name} requests`, undefined, {
        details: [["requested", requested.describe()], ...(offered.length > 0 ? offered : [["offered", "(nothing)"] as [string, string]])],
      });
    }
    throw new ShardError("config", `Several variants of ${owner} match what ${this.name} requests`,
      "add an attribute to the request or a disambiguation rule", {
        details: [["requested", requested.describe()], ...offered],
      });
  }
}

/** Reverse post-order: a node always comes before everything it depends on. */
function consumerFirst(roots: readonly ResolvedNode[]): ResolvedNode[] {
  const post: ResolvedNode[] = [];
  const seen = new Set<ResolvedNode>();
  const walk = (node: ResolvedNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    node.dependencies.forEach(walk);
    post.push(node);
  };
  [...roots].reverse().forEach(walk);
  return post.reverse();
}

class ArtifactsProvider extends Provider<Artifact[]> {
  constructor(private readonly nodes: () => readonly ResolvedNode[], private readonly type?: string) {
    super();
  }

  get(): Artifact[] {
    return this.nodes()
      .flatMap(node => node.variant.artifacts.get())
      .filter(a => this.type === undefined || a.type === this.type);
  }

  isPresent(): boolean {
    return true;
  }

  producers(): readonly Producer[] {
    const out: Producer[] = [];
    for (const node of this.nodes()) {
      for (const p of node.variant.artifacts.producers()) if (!out.some(x => x.path === p.path)) out.push(p);
    }
    return out;
  }
}
