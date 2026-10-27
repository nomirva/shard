import type { CStandard, LinkType, Profile, StandardOptions, Subsystem } from "../lang/types";
import type { Manifest } from "../manifest/manifest";
import type { CompileOptions } from "../toolchain/toolchain";

/** Run-wide values that override or extend what manifests declare. */
export interface CompileOverrides {
  readonly profile?: Profile;
  readonly defines: readonly string[];
}

/** Effective per-target settings: the single place where CLI > manifest > default is decided. */
export interface TargetSettings {
  readonly compile: Omit<CompileOptions, "includePaths">;
  readonly link: {
    readonly type: LinkType | null;
    readonly subsystem?: Subsystem;
    readonly extra?: string[];
  };
}

export function resolveTargetSettings(
  manifest: Manifest,
  effectiveStandard: CStandard | undefined,
  link: LinkType | null,
  overrides: CompileOverrides,
): TargetSettings {
  const o = manifest.options;
  const version = effectiveStandard ?? o.standard?.version;
  const standard: StandardOptions | undefined =
    version !== undefined || o.standard?.pedantic !== undefined
      ? { version, pedantic: o.standard?.pedantic, support: o.standard?.support }
      : undefined;

  // Key order is part of the cache fingerprint (JSON.stringify of CompileOptions).
  return {
    compile: {
      profile: overrides.profile ?? o.profile,
      standard,
      warnings: o.warnings,
      defines: [...(o.defines ?? []), ...overrides.defines],
      extra: o.compileExtra,
    },
    link: { type: link, subsystem: o.subsystem, extra: o.linkExtra },
  };
}
