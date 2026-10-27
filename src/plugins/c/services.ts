import { attribute, service } from "../../core";
import type { CacheMode } from "../../cache/cache";
import type { Profile } from "../../lang/types";
import type { Runner } from "../../build/runner";
import type { Toolchain } from "../../toolchain/toolchain";

/** The C toolchain of this build; registered by a toolchain plugin such as `clang`. */
export const C_TOOLCHAIN = service<Toolchain>("c.toolchain");

/** Runs toolchain invocations; registered by the CLI, a process runner by default. */
export const C_RUNNER = service<Runner>("c.runner");

/** Run-wide overrides from the command line. */
export interface CParameters {
  readonly profile?: Profile;
  /** `--def` values: added to every module's defines. */
  readonly defines: readonly string[];
  readonly cacheMode: CacheMode;
}

export const C_PARAMETERS = service<CParameters>("c.parameters");

export const DEFAULT_PARAMETERS: CParameters = { defines: [], cacheMode: 0 };

/**
 * How a library is linked: "static" or "shared". Consumers that do not ask
 * get static; once any edge in the build asks for shared, every edge gets it.
 */
export const LINKAGE = attribute<string>("linkage");

/** Artifact types published by C libraries. */
export const ARTIFACT = {
  INCLUDE_DIR: "c.include-dir",
  LINK_FILE: "c.link-file",
  LINK_FLAG: "c.link-flag",
  /** A shared library to place next to executables; `value` is the path. */
  RUNTIME: "c.runtime",
  /** Like RUNTIME, copied only if the producer actually built it. */
  RUNTIME_IF_BUILT: "c.runtime-if-built",
} as const;
