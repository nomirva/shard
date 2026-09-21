import { existsSync } from "fs";
import { dirname, join } from "path";
import { Glob } from "bun";
import { PackageShape } from "./types";
import type { Manifest } from "./manifest";
import { expandField, expandPaths } from "./glob";
import { relativeTo } from "../utils/paths";
import { ShardError } from "../utils/errors";
import { Unit } from "./unit";

export interface ExportEntry {
  unit: Unit;
  dest: string;
}

export interface ModuleContent {
  sources: Unit[];
  exports: ExportEntry[];
  artifacts: Unit[];
}

export function scanContent(modulePath: string, manifest: Manifest): ModuleContent {
  return {
    sources: collectSources(modulePath, manifest),
    exports: resolveExports(modulePath, manifest),
    artifacts: collectArtifacts(modulePath),
  };
}

export function deriveShape(content: ModuleContent, label: string): PackageShape {
  if (content.sources.some(u => u.isMain)) return PackageShape.Executable;
  if (content.sources.length > 0) return PackageShape.Library;
  if (content.artifacts.length > 0) return PackageShape.Prebuilt;
  if (content.exports.length > 0) return PackageShape.HeaderOnly;
  throw new ShardError("config", `Module "${label}" is empty: no sources, exports, or artifacts`);
}

export function privateIncludes(
  modulePath: string,
  manifest: Manifest,
  content: ModuleContent,
): string[] {
  const dirs: string[] = [];
  const add = (d: string): void => { if (!dirs.includes(d)) dirs.push(d); };

  for (const u of content.sources) add(dirname(u.path));

  const imports = manifest.imports;
  if (imports) {
    const items = Array.isArray(imports) ? imports : Object.keys(imports);
    for (const p of items) {
      const abs = join(modulePath, p);
      if (existsSync(abs)) add(abs);
    }
  }
  return dirs;
}

function collectSources(modulePath: string, manifest: Manifest): Unit[] {
  const patterns = manifest.sources ?? ["./src/**/*.c"];
  return expandField(modulePath, patterns)
    .map(p => new Unit(p))
    .filter(u => u.isC);
}

function collectArtifacts(modulePath: string): Unit[] {
  const targetDir = join(modulePath, "target");
  if (!existsSync(targetDir)) return [];
  return Array.from(new Glob("**/*").scanSync({ cwd: targetDir }))
    .map(rel => new Unit(join(targetDir, rel)))
    .filter(u => u.isArtifact);
}

function resolveExports(modulePath: string, manifest: Manifest): ExportEntry[] {
  const field = manifest.exports;
  if (!field) return [];

  const entries: ExportEntry[] = [];
  const add = (abs: string, dest: string): void => {
    if (dest) entries.push({ unit: new Unit(abs), dest });
  };

  if (Array.isArray(field)) {
    for (const entry of field) {
      for (const abs of expandPaths(modulePath, entry)) {
        add(abs, relativeTo(modulePath, abs).split("/").slice(1).join("/"));
      }
    }
    return entries;
  }

  for (const [prefix, patterns] of Object.entries(field)) {
    const base = join(modulePath, prefix);
    for (const pattern of patterns) {
      for (const abs of expandPaths(base, pattern)) {
        const rel = relativeTo(modulePath, abs);
        add(abs, rel.startsWith(prefix + "/") ? rel.slice(prefix.length + 1) : "");
      }
    }
  }
  return entries;
}
