import { PluginRegistry } from "../core";
import { cPlugin } from "./c";
import { clangPlugin } from "./clang";
import { gitNotation } from "./git";
import { localNotation } from "./local";
import { scriptsPlugin } from "./scripts";
import { frameworkNotation, sysNotation } from "./system";

/** Plugins and dependency sources shipped with shard. */
export function builtinPlugins(): PluginRegistry {
  return new PluginRegistry()
    .plugin("c", cPlugin)
    .plugin("clang", clangPlugin)
    .plugin("scripts", scriptsPlugin)
    .notation(localNotation)
    .notation(sysNotation)
    .notation(frameworkNotation)
    .notation(gitNotation);
}

/** Applied to a module whose config does not list `plugins`. */
export const DEFAULT_PLUGINS = ["c", "clang", "scripts"] as const;
