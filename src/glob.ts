import { existsSync, readdirSync } from "fs";
import { join, relative } from "path";

function segmentMatches(pat: string, seg: string): boolean {
  if (pat === "*") return true;
  if (!pat.includes("*")) return pat === seg;
  const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$").test(seg);
}

function matchSegments(pat: string[], path: string[], pi: number, hi: number): boolean {
  if (pi >= pat.length && hi >= path.length) return true;
  if (pi >= pat.length) return false;

  if (pat[pi] === "**") {
    if (matchSegments(pat, path, pi + 1, hi)) return true;
    if (hi < path.length) return matchSegments(pat, path, pi, hi + 1);
    return false;
  }

  if (hi >= path.length) return false;

  if (segmentMatches(pat[pi], path[hi])) {
    return matchSegments(pat, path, pi + 1, hi + 1);
  }

  return false;
}

export function match(pattern: string, path: string): boolean {
  const patSegs = pattern.split("/").filter(Boolean);
  const pathSegs = path.split("/").filter(Boolean);
  return matchSegments(patSegs, pathSegs, 0, 0);
}

export function globFiles(baseDir: string, pattern: string): string[] {
  if (!existsSync(baseDir)) return [];

  if (!pattern.includes("*")) {
    const abs = join(baseDir, pattern);
    if (existsSync(abs)) return [pattern];
    return [];
  }

  const result: string[] = [];
  const absBase = join(baseDir, ".");
  walkDir(absBase, baseDir, pattern, result);
  return result;
}

function walkDir(currentDir: string, baseDir: string, pattern: string, result: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relPath = relative(baseDir, join(currentDir, entry.name));
    if (match(pattern, relPath)) {
      result.push(relPath);
    }
    if (entry.isDirectory()) {
      walkDir(join(currentDir, entry.name), baseDir, pattern, result);
    }
  }
}
