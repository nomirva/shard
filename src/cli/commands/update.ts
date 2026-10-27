import chalk from "chalk";
import { updatePipeline } from "../../pipeline/pipelines";
import { openWorkspace } from "./workspace";

export async function updateCommand(path: string, flags: { gitProtocol?: string } = {}): Promise<void> {
  const ws = openWorkspace(path, true, { gitProtocol: flags.gitProtocol });
  await updatePipeline.run(undefined, ws);
  console.log(chalk.dim("Modules synced —") + " dependency modules up to date");
}
