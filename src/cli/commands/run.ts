import { basename } from "path";
import { SCRIPTS } from "../../plugins/scripts";
import { ShardError } from "../../utils/errors";
import { createConsole } from "../console/session";
import { openBuild, runTasks } from "../engine";

/** `shard run <script>`: runs one script of the root module with its output on the terminal. */
export async function runCommand(script: string, path: string): Promise<void> {
  const ui = createConsole();
  const open = await openBuild(path, { reporter: ui, dependencies: false });
  const scripts = open.root.extensions.find(SCRIPTS);
  const task = scripts?.task(script);
  if (!task) {
    throw new ShardError("config", `Script "${script}" is not defined in ${basename(open.root.configFile ?? "shard.json")}`, undefined, {
      details: [["module", open.root.name], ["available", scripts?.names().join(", ") || "(none)"]],
    });
  }
  task.configure(t => { t.inheritOutput = true; });
  await runTasks(open, [task.path], { reporter: ui, jobs: 1, buildEvents: false, configure: false });
}
