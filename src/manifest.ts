import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Toolchain } from "./toolchain/types";
import { PackageShape, type PackageJson } from "./types";
import { ConditionalParser } from "./conditional";
import { Dependency } from "./dependency";

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
}

export class Version {
  static parse(s: string): VersionInfo | null {
    const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return { major: parseInt(m[1]), minor: parseInt(m[2]), patch: m[3] !== undefined ? parseInt(m[3]) : 0 };
  }

  static compatible(a: string, b: string): boolean {
    const pa = Version.parse(a);
    const pb = Version.parse(b);
    if (pa && pb) return pa.major === pb.major;
    return a === b;
  }

  static newer(a: string, b: string): boolean {
    const pa = Version.parse(a);
    const pb = Version.parse(b);
    if (!pa || !pb) return false;
    if (pa.major !== pb.major) return pa.major > pb.major;
    if (pa.minor !== pb.minor) return pa.minor > pb.minor;
    return pa.patch > pb.patch;
  }
}

export interface ManifestInfo {
  name: string;
  type: PackageShape;
  includePaths: string[];
  deps: Dependency[];
}

export class Manifest {
  static parse(pkgPath: string, tc?: Toolchain): PackageJson {
    const manifestPath = join(pkgPath, "module.json");
    const raw = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};
    const rawDefines: string[] = raw.options?.defines ?? [];
    return ConditionalParser.compute(tc, rawDefines, raw) as PackageJson;
  }

  static readVersion(pkgPath: string): string | null {
    const p = join(pkgPath, "module.json");
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      return raw.version ?? null;
    } catch {
      return null;
    }
  }

  static writeVersion(pkgPath: string, version: string): void {
    const p = join(pkgPath, "module.json");
    const raw = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : {};
    raw.version = version;
    writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");
  }

  static info(mod: ManifestInfo): void {
    console.log(`\n  Name: ${mod.name}`);
    console.log(`  Type: ${mod.type}`);
    console.log(`  Include: ${mod.includePaths[0] ?? "(none)"}`);

    if (mod.deps.length) {
      console.log(`  Dependencies (${mod.deps.length}):`);
      for (const d of mod.deps) {
        console.log(`    - ${d.prefix}:${d.value} [${d.label}]`);
      }
    } else {
      console.log(`  Dependencies: none`);
    }
  }
}
