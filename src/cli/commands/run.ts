import { openWorkspace } from "./workspace";

export function runCommand(script: string, path: string): void {
  const ws = openWorkspace(path, false);
  ws.hooks.runScript(ws.declareRoot(), script);
}
