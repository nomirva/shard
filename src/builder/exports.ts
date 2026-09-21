import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { Module } from "../module/module";
import type { Layout } from "./layout";

export function copyExports(module: Module, layout: Layout): void {
  const entries = module.content?.exports ?? [];
  for (const { unit, dest } of entries) {
    const target = join(layout.includeDir, dest);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(unit.path, target);
  }
}
