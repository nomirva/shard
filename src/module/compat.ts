import type { Module } from "./module";
import type { ModuleGraph } from "./graph";
import type { CStandard } from "./types";
import { dominates, isPureC, oldestStandard, olderStandard, rankOf } from "./standards";
import { ShardError } from "../utils/errors";

export function resolveStandards(graph: ModuleGraph): Map<Module, CStandard | undefined> {
  const effective = new Map<Module, CStandard | undefined>();
  const root = graph.root;
  effective.set(root, root.manifest.options.standard?.version);

  for (const module of [...graph.topoOrder()].reverse()) {
    const inherited = effective.get(module);
    for (const child of graph.children(module)) {
      const candidate = child.manifest.options.standard?.version ?? inherited;
      const current = effective.has(child) ? effective.get(child) : undefined;
      effective.set(child, olderStandard(current, candidate));
    }
  }
  return effective;
}

export function checkCompatibility(
  graph: ModuleGraph,
  standards: Map<Module, CStandard | undefined>,
): void {
  for (const consumer of graph.topoOrder()) {
    const consumerStd = standards.get(consumer);
    if (!consumerStd) continue;

    for (const provider of descendants(graph, consumer)) {
      if (!provider.content || provider.content.exports.length === 0) continue;

      const baselines: CStandard[] = [];
      const providerStd = standards.get(provider);
      if (providerStd) baselines.push(providerStd);
      const support = provider.manifest.options.standard?.support;
      if (support) baselines.push(support);
      if (baselines.length === 0) continue;

      if (baselines.some(baseline => dominates(consumerStd, baseline))) continue;

      const dialectBlocked = baselines.some(
        baseline => rankOf(consumerStd) >= rankOf(baseline) && !isPureC(baseline) && isPureC(consumerStd),
      );
      if (dialectBlocked) {
        throw new ShardError(
          "config",
          `Module '${provider.name}' exports GNU-dialect headers, but '${consumer.name}' uses pure C (${consumerStd}).`,
          "Exported headers use GNU extensions; a pure C consumer cannot use them.",
        );
      }

      throw new ShardError(
        "config",
        `Module '${provider.name}' exports headers requiring at least ${oldestStandard(baselines)}, but '${consumer.name}' uses ${consumerStd}.`,
        `Lower '${provider.name}'.standard.support to '${consumerStd}' if the headers are compatible.`,
      );
    }
  }
}

function descendants(graph: ModuleGraph, module: Module): Module[] {
  const out: Module[] = [];
  const seen = new Set<Module>();
  const walk = (m: Module): void => {
    for (const child of graph.children(m)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      walk(child);
    }
  };
  walk(module);
  return out;
}
