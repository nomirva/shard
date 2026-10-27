import { resolve } from "path";
import { Workspace } from "../../workspace/workspace";
import { createSettings, type SettingsInput } from "../../workspace/settings";
import { createConsoleReporter } from "../console/reporter";

export function openWorkspace(path: string, toolchain: boolean, settings: SettingsInput = {}): Workspace {
  return Workspace.open(resolve(path), {
    settings: createSettings(settings),
    reporter: createConsoleReporter(),
    toolchain,
  });
}
