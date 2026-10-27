import { createConsole } from "../console/session";
import { openWorkspace } from "./workspace";

export function runCommand(script: string, path: string): void {
  const ws = openWorkspace(path, createConsole(), false);
  ws.hooks.runScript(ws.declareRoot(), script);
}
