import { PluginRegistry } from "../core";
import { cPlugin } from "./c";
import { clangPlugin } from "./clang";
import { localNotation } from "./local";

/** Plugins and dependency sources shipped with shard. */
export function builtinPlugins(): PluginRegistry {
  return new PluginRegistry()
    .plugin("c", cPlugin)
    .plugin("clang", clangPlugin)
    .notation(localNotation);
}

/** Applied to a module whose config does not list `plugins`. */
export const DEFAULT_PLUGINS = ["c", "clang"] as const;
