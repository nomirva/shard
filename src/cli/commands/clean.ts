import { openWorkspace } from "./workspace";

export function cleanCommand(path: string): void {
  const ws = openWorkspace(path, false);
  ws.hooks.run(ws.declareRoot(), "preclean");
  for (const dir of ws.clean()) console.log(`  removed: ${dir}`);
}
