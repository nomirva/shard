import { CompileCache } from "../../cache/cache";
import { JsonCacheStore } from "../../cache/store";
import { Executor } from "../../build/executor";
import type { PlannedTarget } from "../../build/plan";
import { processRunner } from "../../build/runner";
import type { TargetGraph } from "../../target/graph";
import type { Stage } from "../pipeline";

export const execute: Stage<TargetGraph<PlannedTarget>, TargetGraph<PlannedTarget>> = {
  name: "execute",
  async run(graph, ws) {
    const cache = new CompileCache(new JsonCacheStore(ws.shardDir), ws.toolchain.deps);
    await new Executor(ws, processRunner, cache).execute(graph);
    return graph;
  },
};
