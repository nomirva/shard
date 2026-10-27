import chalk from "chalk";
import pkg from "../../../package.json" with { type: "json" };
import { updatePipeline } from "../../pipeline/pipelines";
import { createConsole } from "../console/session";
import { openWorkspace, toolchainFacts } from "./workspace";

export async function updateCommand(path: string, flags: { gitProtocol?: string; verbose?: boolean } = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const ws = openWorkspace(path, ui, true, { gitProtocol: flags.gitProtocol });
  ui.emit({ type: "run.start", noun: "Update", title: `shard ${pkg.version}`, details: toolchainFacts(ws.toolchain) });

  const removed = await updatePipeline.run(undefined, ws);
  if (removed.length > 0) {
    ui.print();
    ui.print(` ${chalk.bold("Removed")}`);
    for (const name of removed) ui.print(`   ${chalk.red("−")} ${name}`);
  }
  ui.emit({
    type: "run.end",
    label: "Modules synced",
    artifacts: [],
    stats: removed.length > 0 ? [`${removed.length} removed`] : [],
  });
}
