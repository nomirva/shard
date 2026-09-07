import { existsSync, statSync } from "fs";
import { join } from "path";
import { Glob } from "bun";
import { PackageShape, PackageJson } from "./types";
import { Unit } from "./unit";

export interface ModuleContent {
  sourceUnits: Unit[];
  headerUnits: Unit[];
  artifactUnits: Unit[];
}

export function collectModuleContent(modulePath: string, manifest: PackageJson): ModuleContent {
  return {
    sourceUnits: collectSourceUnits(modulePath, manifest),
    headerUnits: collectHeaderUnits(modulePath, manifest),
    artifactUnits: collectArtifactUnits(modulePath),
  };
}

function collectSourceUnits(modulePath: string, manifest: PackageJson): Unit[] {
  const patterns = manifest.sources ?? ["./src/**/*.c"];
  const units = resolveUnitField(modulePath, patterns);
  return units.filter(u => u.isC);
}

function collectHeaderUnits(modulePath: string, manifest: PackageJson): Unit[] {
  if (!manifest.exports) return [];
  const units = resolveUnitField(modulePath, manifest.exports);
  return units.filter(u => u.isHeader);
}

function collectArtifactUnits(modulePath: string): Unit[] {
  const targetDir = join(modulePath, "target");
  if (!existsSync(targetDir)) return [];
  return Array.from(new Glob("**/*").scanSync({ cwd: targetDir }))
    .map(rel => new Unit(join(targetDir, rel)))
    .filter(u => u.isArtifact);
}

function resolveUnitField(modulePath: string, field: string[] | Record<string, string[]>): Unit[] {
  const units: Unit[] = [];

  if (Array.isArray(field)) {
    for (const entry of field) {
      units.push(...expand(modulePath, entry));
    }
    return units;
  }

  for (const [prefix, patterns] of Object.entries(field)) {
    const base = join(modulePath, prefix);
    for (const pattern of patterns) {
      units.push(...expand(base, pattern));
    }
  }
  return units;
}

function expand(baseDir: string, pattern: string): Unit[] {
  const abs = join(baseDir, pattern);
  if (!pattern.includes("*") && existsSync(abs)) {
    if (statSync(abs).isDirectory()) {
      return Array.from(new Glob("**/*").scanSync({ cwd: abs }))
        .map(rel => new Unit(join(abs, rel)));
    }
    return [new Unit(abs)];
  }

  if (!existsSync(baseDir)) return [];
  return Array.from(new Glob(pattern).scanSync({ cwd: baseDir }))
    .map(rel => new Unit(join(baseDir, rel)));
}

export function deriveShape(content: ModuleContent): PackageShape {
  if (content.sourceUnits.some(u => u.isMain)) return PackageShape.Executable;
  if (content.sourceUnits.length > 0) return PackageShape.Library;
  if (content.artifactUnits.length > 0) return PackageShape.Prebuilt;
  if (content.headerUnits.length > 0) return PackageShape.HeaderOnly;
  throw new Error("Module is empty: no sources, exports, or artifacts");
}
