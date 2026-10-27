import { basename } from "path";
import chalk from "chalk";
import { createConsole } from "../console/session";
import { size } from "../console/format";
import { openWorkspace } from "./workspace";

export function cleanCommand(path: string): void {
  const ui = createConsole();
  const ws = openWorkspace(path, ui, false);
  ws.hooks.run(ws.declareRoot(), "preclean");

  const removed = ws.clean();
  const total = removed.reduce((sum, r) => sum + r.bytes, 0);
  ui.print();
  ui.print(removed.length === 0
    ? ` ${chalk.green("✔")} ${chalk.bold("nothing to clean")}`
    : ` ${chalk.green("✔")} ${chalk.bold(`removed ${removed.map(r => basename(r.dir)).join(", ")}`)} ${chalk.dim(`· ${size(total)} freed`)}`);
  ui.print();
}
