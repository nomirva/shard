import type { Profile } from "../lang/types";
import type { CacheMode } from "../cache/cache";
import type { CompileOverrides } from "../target/settings";

/**
 * Run-wide settings, split by the stage that consumes them; a stage reads
 * only its own section.
 */
export interface WorkspaceSettings {
  readonly resolve: ResolveSettings;
  readonly compile: CompileOverrides;
  readonly cache: CacheSettings;
}

export interface ResolveSettings {
  /** Defines visible to `?define:` conditionals while reading manifests. */
  readonly defines: readonly string[];
  readonly gitProtocol: string;
}

export interface CacheSettings {
  readonly mode: CacheMode;
}

export interface SettingsInput {
  defines?: readonly string[];
  profile?: Profile;
  cacheMode?: CacheMode;
  gitProtocol?: string;
}

export function createSettings(input: SettingsInput = {}): WorkspaceSettings {
  const defines = input.defines ?? [];
  return {
    resolve: { defines, gitProtocol: input.gitProtocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https" },
    compile: { defines, profile: input.profile },
    cache: { mode: input.cacheMode ?? 0 },
  };
}
