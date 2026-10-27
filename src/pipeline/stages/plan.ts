import { planBuild } from "../../build/planner";
import type { PlannedTarget } from "../../build/plan";
import type { TargetGraph } from "../../target/graph";
import type { PreparedTarget } from "../../target/target";
import type { Stage } from "../pipeline";

export const plan: Stage<TargetGraph<PreparedTarget>, TargetGraph<PlannedTarget>> = {
  name: "plan",
  run: (graph, ws) => planBuild(graph, ws),
};
