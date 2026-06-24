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
  pre: string[];
  build: string[];
}

export class Version {
  static parse(s: string): VersionInfo | null {
    const re = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    const m = re.exec(s);
    if (!m) return null;
    return {
      major: +m[1], minor: +m[2], patch: +m[3],
      pre: m[4] ? m[4].split('.') : [],
      build: m[5] ? m[5].split('.') : [],
    };
  }

  static compare(a: string | VersionInfo, b: string | VersionInfo): number {
    const va = typeof a === 'string' ? Version.parse(a) : a;
    const vb = typeof b === 'string' ? Version.parse(b) : b;
    if (!va || !vb) return NaN;

    if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
    if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
    if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

    const pa = va.pre;
    const pb = vb.pre;
    if (!pa.length && !pb.length) return 0;
    if (!pa.length) return 1;
    if (!pb.length) return -1;

    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const ia = pa[i], ib = pb[i];
      const na = /^\d+$/.test(ia);
      const nb = /^\d+$/.test(ib);
      if (na && nb) {
        if (+ia !== +ib) return +ia < +ib ? -1 : 1;
      } else if (!na && !nb) {
        if (ia < ib) return -1;
        if (ia > ib) return 1;
      } else {
        return na ? -1 : 1;
      }
    }
    return pa.length === pb.length ? 0 : pa.length > pb.length ? 1 : -1;
  }

  static compatible(a: string, b: string): boolean {
    const pa = Version.parse(a);
    const pb = Version.parse(b);
    if (pa && pb) return pa.major === pb.major;
    return a === b;
  }

  static newer(a: string, b: string): boolean {
    return Version.compare(a, b) > 0;
  }
}

export interface ManifestInfo {
  name: string;
  type: PackageShape;
  includePaths: string[];
  deps: Dependency[];
}

export class Manifest {
  static readonly FILE_NAME = "shard.json";

  static parse(pkgPath: string, tc?: Toolchain): PackageJson {
    const manifestPath = join(pkgPath, Manifest.FILE_NAME);
    const raw = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf-8"))
      : {};
    const rawDefines: string[] = raw.options?.defines ?? [];
    return ConditionalParser.compute(tc, rawDefines, raw) as PackageJson;
  }

  static readVersion(pkgPath: string): string | null {
    const p = join(pkgPath, Manifest.FILE_NAME);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      return raw.version ?? null;
    } catch {
      return null;
    }
  }

  static writeVersion(pkgPath: string, version: string): void {
    const p = join(pkgPath, Manifest.FILE_NAME);
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
