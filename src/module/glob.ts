import { existsSync, statSync } from "fs";
import { join } from "path";
import { Glob } from "bun";
import type { PathPatterns } from "./types";

function hasGlobMeta(s: string): boolean {
  return /[*?[\]]/.test(s);
}

export function expandPaths(baseDir: string, pattern: string): string[] {
  const abs = join(baseDir, pattern);
  if (!hasGlobMeta(pattern) && existsSync(abs)) {
    if (statSync(abs).isDirectory()) {
      return Array.from(new Glob("**/*").scanSync({ cwd: abs })).map(rel => join(abs, rel));
    }
    return [abs];
  }

  if (!existsSync(baseDir)) return [];
  return Array.from(new Glob(pattern).scanSync({ cwd: baseDir })).map(rel => join(baseDir, rel));
}

export function expandField(baseDir: string, field: PathPatterns): string[] {
  const out: string[] = [];

  if (Array.isArray(field)) {
    for (const entry of field) out.push(...expandPaths(baseDir, entry));
    return out;
  }

  for (const [prefix, patterns] of Object.entries(field)) {
    const dir = join(baseDir, prefix);
    for (const pattern of patterns) out.push(...expandPaths(dir, pattern));
  }
  return out;
}
