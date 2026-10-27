import type { GraphNode, TargetGraph } from "./graph";

/*
 * Settings that flow along the dependency tree are expressed as rules,
 * so a new inherited or aggregated setting needs a rule, not a new stage.
 * Results are keyed by module path and stay valid for later phases.
 */

/** Flows from dependents to dependencies (e.g. the inherited C standard). */
export interface DownRule<T extends GraphNode, V> {
  root(node: T): V;
  /** Value a child receives through one edge from a parent holding `parent`. */
  inherit(parent: V, child: T): V;
  /** Combines values arriving through several edges. */
  merge(current: V, incoming: V): V;
}

/** Flows from dependencies to dependents (e.g. include dirs and libraries to link). */
export interface UpRule<T extends GraphNode, V> {
  compute(node: T, fromChildren: V[]): V;
}

export function propagateDown<T extends GraphNode, V>(graph: TargetGraph<T>, rule: DownRule<T, V>): Map<string, V> {
  const values = new Map<string, V>();
  values.set(graph.root.path, rule.root(graph.root));
  for (const node of [...graph.topoOrder()].reverse()) {
    const value = values.get(node.path) as V;
    for (const child of graph.children(node)) {
      const incoming = rule.inherit(value, child);
      values.set(child.path, values.has(child.path) ? rule.merge(values.get(child.path) as V, incoming) : incoming);
    }
  }
  return values;
}

export function propagateUp<T extends GraphNode, V>(graph: TargetGraph<T>, rule: UpRule<T, V>): Map<string, V> {
  const values = new Map<string, V>();
  for (const node of graph.topoOrder()) {
    values.set(node.path, rule.compute(node, graph.children(node).map(child => values.get(child.path) as V)));
  }
  return values;
}
