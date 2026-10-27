import { attribute, service } from "../../core";
import type { CacheMode } from "./cache";
import type { Profile } from "./lang/types";
import type { Runner } from "./runner";
import type { Toolchain } from "./toolchain/toolchain";

export const C_TOOLCHAIN = service<Toolchain>("c.toolchain");

export const C_RUNNER = service<Runner>("c.runner");

export interface CParameters {
  readonly profile?: Profile;
  readonly defines: readonly string[];
  readonly cacheMode: CacheMode;
}

export const C_PARAMETERS = service<CParameters>("c.parameters");

export const DEFAULT_PARAMETERS: CParameters = { defines: [], cacheMode: 0 };

export const LINKAGE = attribute<string>("linkage");

export const ARTIFACT = {
  INCLUDE_DIR: "c.include-dir",
  LINK_FILE: "c.link-file",
  LINK_FLAG: "c.link-flag",
  RUNTIME: "c.runtime",
  RUNTIME_IF_BUILT: "c.runtime-if-built",
} as const;
