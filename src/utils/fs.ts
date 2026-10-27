import { lstatSync, readdirSync } from "fs";
import { isAbsolute, join, relative } from "path";

export function relativeTo(fromDir: string, file: string): string {
  const rel = relative(fromDir, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${file}" is outside "${fromDir}"`);
  }
  return rel;
}

export function diskUsage(path: string): number {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += diskUsage(join(path, entry));
  return total;
}
