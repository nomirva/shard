import type { CStandard } from "../lang/types";
import { dominates, isPureC, oldestStandard, olderStandard, rankOf } from "../lang/standards";
import { ShardError } from "../utils/errors";
import type { TargetGraph } from "../target/graph";
import { propagateDown, type DownRule } from "../target/propagate";
import type { DeclaredTarget, ScannedTarget } from "../target/target";

/**
 * A module without its own `standard.version` inherits its dependents' standard;
 * through several paths the oldest one wins (pure `c` over `gnu` on a tie).
 */
const inheritedStandard: DownRule<DeclaredTarget, CStandard | undefined> = {
  root: root => root.manifest.options.standard?.version,
  inherit: (parent, child) => child.manifest.options.standard?.version ?? parent,
  merge: olderStandard,
};

export function resolveStandards(graph: TargetGraph<DeclaredTarget>): Map<string, CStandard | undefined> {
  return propagateDown(graph, inheritedStandard);
}

/** Every consumer must be able to include the headers exported by its transitive dependencies. */
export function checkCompatibility(
  graph: TargetGraph<ScannedTarget>,
  standards: Map<string, CStandard | undefined>,
): void {
  for (const consumer of graph.topoOrder()) {
    const consumerStd = standards.get(consumer.path);
    if (!consumerStd) continue;

    for (const provider of graph.descendants(consumer)) {
      if (provider.content.exports.length === 0) continue;

      const baselines: CStandard[] = [];
      const providerStd = standards.get(provider.path);
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
