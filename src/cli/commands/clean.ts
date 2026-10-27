import chalk from "chalk";
import { createConsole } from "../console/session";
import { rel, size } from "../console/format";
import { openWorkspace } from "./workspace";

export function cleanCommand(path: string): void {
  const ui = createConsole();
  const ws = openWorkspace(path, ui, false);
  const root = ws.declareRoot();
  ws.hooks.run(root, "preclean");

  const removed = ws.clean();
  if (removed.length === 0) {
    ui.emit({ type: "run.end", label: `Nothing to clean in ${root.name}`, artifacts: [] });
    return;
  }
  ui.print();
  for (const { dir, bytes } of removed) ui.print(`   ${chalk.red("−")} ${rel(dir)}  ${chalk.dim(size(bytes))}`);
  const total = removed.reduce((sum, r) => sum + r.bytes, 0);
  ui.emit({ type: "run.end", label: `Cleaned ${root.name}`, artifacts: [], stats: [`${size(total)} freed`] });
}
