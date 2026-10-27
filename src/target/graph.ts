import type { LinkType } from "../lang/types";
import { ShardError } from "../utils/errors";

export interface GraphNode {
  readonly path: string;
}

/**
 * The dependency tree, shared by every pipeline phase. Nodes are keyed by
 * module path; `map` produces the next phase over the same topology.
 */
export class TargetGraph<T extends GraphNode> {
  private constructor(
    private readonly rootPath: string,
    private readonly nodes: ReadonlyMap<string, T>,
    private readonly edges: ReadonlyMap<string, readonly string[]>,
    private readonly links: ReadonlyMap<string, LinkType | null>,
  ) {}

  static builder<T extends GraphNode>(): GraphBuilder<T> {
    return new GraphBuilder<T>((root, nodes, edges, links) => new TargetGraph(root, nodes, edges, links));
  }

  get root(): T {
    return this.nodes.get(this.rootPath)!;
  }

  isRoot(node: GraphNode): boolean {
    return node.path === this.rootPath;
  }

  children(node: GraphNode): T[] {
    return (this.edges.get(node.path) ?? []).map(path => this.nodes.get(path)!);
  }

  /** Link type requested by the first edge that reached this node. */
  linkOf(node: GraphNode): LinkType | null {
    return this.links.get(node.path) ?? null;
  }

  /** Dependencies before dependents (DFS post-order from the root). */
  topoOrder(): T[] {
    const out: T[] = [];
    const seen = new Set<string>();
    const walk = (node: T): void => {
      if (seen.has(node.path)) return;
      seen.add(node.path);
      for (const child of this.children(node)) walk(child);
      out.push(node);
    };
    walk(this.root);
    return out;
  }

  /** Transitive dependencies in DFS pre-order. */
  descendants(node: GraphNode): T[] {
    const out: T[] = [];
    const seen = new Set<string>();
    const walk = (n: GraphNode): void => {
      for (const child of this.children(n)) {
        if (seen.has(child.path)) continue;
        seen.add(child.path);
        out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  }

  /** Next phase: `fn` runs once per node in topological order and must keep the node's path. */
  map<U extends GraphNode>(fn: (node: T) => U): TargetGraph<U> {
    const nodes = new Map<string, U>();
    for (const node of this.topoOrder()) {
      const next = fn(node);
      if (next.path !== node.path) {
        throw new ShardError("build", `Graph phase changed node identity: "${node.path}" → "${next.path}"`);
      }
      nodes.set(node.path, next);
    }
    return new TargetGraph(this.rootPath, nodes, this.edges, this.links);
  }
}

type GraphFactory<T extends GraphNode> = (
  root: string,
  nodes: Map<string, T>,
  edges: Map<string, string[]>,
  links: Map<string, LinkType | null>,
) => TargetGraph<T>;

export class GraphBuilder<T extends GraphNode> {
  private readonly nodes = new Map<string, T>();
  private readonly edges = new Map<string, string[]>();
  private readonly links = new Map<string, LinkType | null>();
  private rootPath: string | null = null;

  constructor(private readonly factory: GraphFactory<T>) {}

  get(path: string): T | undefined {
    return this.nodes.get(path);
  }

  /** Adds the node unless one with the same path exists; returns the stored node. */
  add(node: T): T {
    const existing = this.nodes.get(node.path);
    if (existing) return existing;
    this.nodes.set(node.path, node);
    this.edges.set(node.path, []);
    return node;
  }

  setRoot(node: T): T {
    const stored = this.add(node);
    this.rootPath = stored.path;
    return stored;
  }

  connect(parent: T, child: T, link: LinkType | null): void {
    this.add(parent);
    this.add(child);
    const children = this.edges.get(parent.path)!;
    if (!children.includes(child.path)) children.push(child.path);
    if (!this.links.has(child.path)) this.links.set(child.path, link);
  }

  build(): TargetGraph<T> {
    if (this.rootPath === null) throw new ShardError("build", "Module graph has no root");
    return this.factory(this.rootPath, this.nodes, this.edges, this.links);
  }
}
