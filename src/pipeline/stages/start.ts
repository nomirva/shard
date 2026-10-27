import { spawnSync } from "child_process";
import { basename } from "path";
import { ShardError } from "../../utils/errors";
import type { PlannedTarget } from "../../build/plan";
import type { TargetGraph } from "../../target/graph";
import type { Stage } from "../pipeline";

/** `--start`: runs the built root executable and exits with its status. */
export const start: Stage<TargetGraph<PlannedTarget>, never> = {
  name: "start",
  run(graph, ws) {
    const exe = graph.root.build.executable;
    if (!exe) throw new ShardError("usage", `"${basename(ws.rootPath)}" is not an executable module`);
    const proc = spawnSync(exe, [], { stdio: "inherit" });
    if (proc.error) throw proc.error;
    process.exit(proc.status ?? 0);
  },
};
