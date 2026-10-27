import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { ExportEntry } from "../target/content";

export function copyExports(entries: readonly ExportEntry[], includeDir: string): void {
  for (const { unit, dest } of entries) {
    const target = join(includeDir, dest);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(unit.path, target);
  }
}
