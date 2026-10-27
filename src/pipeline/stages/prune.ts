import { ModuleStore } from "../../dependency/store";
import type { TargetGraph } from "../../target/graph";
import type { ResolvedTarget } from "../../target/target";
import type { Stage } from "../pipeline";

/** Removes installed modules the graph no longer reaches. */
export const prune: Stage<TargetGraph<ResolvedTarget>, string[]> = {
  name: "prune",
  run: (graph, ws) => new ModuleStore(ws.modulesDir).prune(graph.topoOrder().map(t => t.path)),
};
