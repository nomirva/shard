import { existsSync, rmSync } from "fs";
import { basename, join } from "path";
import chalk from "chalk";
import { SCRIPTS } from "../../plugins/scripts";
import { diskUsage } from "../../utils/fs";
import { DIRS } from "../../workspace/layout";
import { createConsole } from "../console/session";
import { size } from "../console/format";
import { openBuild, runTasks } from "../engine";

/** `shard clean`: runs `preclean`, then removes build state, installed modules and outputs of the root. */
export async function cleanCommand(path: string): Promise<void> {
  const ui = createConsole();
  const open = await openBuild(path, { reporter: ui, dependencies: false });
  const preclean = open.root.extensions.find(SCRIPTS)?.task("preclean");
  if (preclean) await runTasks(open, [preclean.path], { reporter: ui, jobs: 1, buildEvents: false, configure: false });

  const removed: { dir: string; bytes: number }[] = [];
  for (const dir of [DIRS.SHARD, DIRS.MODULES, DIRS.TARGET].map(d => join(open.build.rootDir, d))) {
    if (!existsSync(dir)) continue;
    const bytes = diskUsage(dir);
    rmSync(dir, { recursive: true, force: true });
    removed.push({ dir, bytes });
  }

  ui.finish();
  const total = removed.reduce((sum, r) => sum + r.bytes, 0);
  ui.print();
  ui.print(removed.length === 0
    ? ` ${chalk.green("✔")} ${chalk.bold("nothing to clean")}`
    : ` ${chalk.green("✔")} ${chalk.bold(`removed ${removed.map(r => basename(r.dir)).join(", ")}`)} ${chalk.dim(`· ${size(total)} freed`)}`);
  ui.print();
}
