import { runHook } from "../utils/scripts";
import { scanContent } from "./content";
import type { Module } from "./module";

export function scan(module: Module): void {
  module.content = scanContent(module.path, module.manifest);
}

export function materialize(module: Module): void {
  runHook(module.path, module.manifest.scripts, "preload");
  scan(module);
}
