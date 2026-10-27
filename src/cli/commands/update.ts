import pkg from "../../../package.json" with { type: "json" };
import { updatePipeline } from "../../pipeline/pipelines";
import { createConsole } from "../console/session";
import { openWorkspace, toolchainFacts } from "./workspace";

export async function updateCommand(path: string, flags: { gitProtocol?: string; verbose?: boolean } = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const ws = openWorkspace(path, ui, true, { gitProtocol: flags.gitProtocol });
  ui.emit({ type: "run.start", command: "update", details: [`shard ${pkg.version}`, ...toolchainFacts(ws.toolchain)] });

  const removed = await updatePipeline.run(undefined, ws);
  const root = ws.declareRoot();
  ui.emit({ type: "run.end", command: "update", subject: root.name, artifacts: [], removed });
}
