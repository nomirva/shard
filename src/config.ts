/*
 * Types for shard.ts. Import them type-only, so nothing is loaded at run time:
 *
 *   import type { ShardConfig } from "<shard>/src/config";
 *
 *   export default (({ defined, local }) => ({
 *     dependencies: [local("../lib", { linkage: "shared" })],
 *     c: { standard: defined("C89") ? "c89" : "c17" },
 *   })) satisfies ShardConfig;
 */
import type { ConfigContext, DependencyNotation } from "./core";
import type { CBlock } from "./plugins/c";
import type { CodegenBlock } from "./plugins/codegen";
import type { GitOptions } from "./plugins/git";
import type { LocalOptions } from "./plugins/local";
import type { SystemOptions } from "./plugins/system";

/**
 * Blocks a config may contain, one per extension. A plugin outside this
 * repository adds its own with declaration merging:
 *
 *   declare module "<shard>/src/config" { interface Blocks { sdl?: SdlBlock } }
 */
export interface Blocks {
  c?: CBlock;
  scripts?: Record<string, string>;
  codegen?: CodegenBlock;
}

/** Dependency helpers configs receive; plugins add theirs the same way as blocks. */
export interface Helpers {
  local(path: string, options?: LocalOptions): DependencyNotation;
  git(repo: string, options?: GitOptions): DependencyNotation;
  sys(name: string, options?: SystemOptions): DependencyNotation;
  framework(name: string, options?: SystemOptions): DependencyNotation;
}

export interface ModuleConfig extends Blocks {
  /** Plugin ids; without it a module gets c, clang and scripts. */
  plugins?: string[];
  /** A list goes to `implementation`; an object names scopes. */
  dependencies?: DependencyNotation[] | Record<string, DependencyNotation[]>;
}

export type Context = Pick<ConfigContext, "platform" | "arch" | "defines" | "defined" | "define"> & Helpers & {
  /** The toolchain's name ("clang"), or "unknown" for commands that do not compile. */
  readonly compiler: string;
};

/** What shard.ts exports by default. */
export type ShardConfig = ModuleConfig | ((ctx: Context) => ModuleConfig | Promise<ModuleConfig>);
