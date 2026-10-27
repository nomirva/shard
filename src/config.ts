import type { ConfigContext, DependencyNotation } from "./core";
import type { CBlock } from "./plugins/c";
import type { CodegenBlock } from "./plugins/codegen";
import type { GitOptions } from "./plugins/git";
import type { LocalOptions } from "./plugins/local";
import type { SystemOptions } from "./plugins/system";

export interface Blocks {
  c?: CBlock;
  scripts?: Record<string, string>;
  codegen?: CodegenBlock;
}

export interface Helpers {
  local(path: string, options?: LocalOptions): DependencyNotation;
  git(repo: string, options?: GitOptions): DependencyNotation;
  sys(name: string, options?: SystemOptions): DependencyNotation;
  framework(name: string, options?: SystemOptions): DependencyNotation;
}

export interface ModuleConfig extends Blocks {
  plugins?: string[];
  dependencies?: DependencyNotation[] | Record<string, DependencyNotation[]>;
}

export type Context = Pick<ConfigContext, "platform" | "arch" | "defines" | "defined" | "define"> & Helpers & {
  readonly compiler: string;
};

export type ShardConfig = ModuleConfig | ((ctx: Context) => ModuleConfig | Promise<ModuleConfig>);
