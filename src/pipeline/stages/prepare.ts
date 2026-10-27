import { checkCompatibility, resolveStandards } from "../../analysis/standards";
import { scanContent } from "../../target/content";
import type { TargetGraph } from "../../target/graph";
import { resolveTargetSettings } from "../../target/settings";
import { deriveShape } from "../../target/shape";
import type { PreparedTarget, ResolvedTarget, ScannedTarget } from "../../target/target";
import type { Stage } from "../pipeline";

/**
 * Runs `preload` and scans every module (dependencies first), checks header
 * compatibility, then fixes shapes and effective settings.
 */
export const prepare: Stage<TargetGraph<ResolvedTarget>, TargetGraph<PreparedTarget>> = {
  name: "prepare",
  run(graph, ws) {
    const scanned = graph.map((target): ScannedTarget => {
      ws.hooks.run(target, "preload");
      return { ...target, content: scanContent(target.path, target.manifest) };
    });

    const standards = resolveStandards(scanned);
    checkCompatibility(scanned, standards);

    return scanned.map((target): PreparedTarget => ({
      ...target,
      shape: deriveShape(target.content, target.name),
      settings: resolveTargetSettings(
        target.manifest,
        standards.get(target.path),
        scanned.linkOf(target),
        ws.settings.compile,
      ),
    }));
  },
};
