import { PluginRegistry } from "../core";
import { cPlugin } from "./c";
import { clangPlugin } from "./clang";
import { codegenPlugin } from "./codegen";
import { gitNotation } from "./git";
import { localNotation } from "./local";
import { scriptsPlugin } from "./scripts";
export { jsonReader } from "./shard-json";
import { frameworkNotation, sysNotation } from "./system";

export function builtinPlugins(): PluginRegistry {
  return new PluginRegistry()
    .plugin("c", cPlugin)
    .plugin("clang", clangPlugin)
    .plugin("scripts", scriptsPlugin)
    .plugin("codegen", codegenPlugin)
    .notation(localNotation)
    .notation(sysNotation)
    .notation(frameworkNotation)
    .notation(gitNotation);
}

export const DEFAULT_PLUGINS = ["c", "clang", "scripts"] as const;
