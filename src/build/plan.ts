import type { ShardError } from "../utils/errors";
import type { LinkKind } from "../report/events";
import type { CompileTask, Invocation } from "../toolchain/toolchain";
import type { PreparedTarget } from "../target/target";
import type { Layout } from "../workspace/layout";
import type { SharedLib, Usage } from "./usage";

/** plan: everything the executor needs, described as data. */
export interface PlannedTarget extends PreparedTarget {
  readonly layout: Layout;
  /** What this target (with its dependencies) offers to dependents. */
  readonly usage: Usage;
  readonly build: TargetBuild;
}

export interface TargetBuild {
  readonly useCache: boolean;
  readonly compile: readonly CompileUnit[];
  readonly link: readonly LinkStep[];
  /** Shared libraries to place next to the executable. */
  readonly ship: { readonly libs: readonly SharedLib[]; readonly toDir: string } | null;
  /** Prebuilt modules must provide this directory. */
  readonly requireDir: string | null;
  readonly executable: string | null;
}

export interface CompileUnit {
  readonly task: CompileTask;
  readonly invocation: Invocation;
  readonly cacheKey: string;
  /** Source path relative to the module. */
  readonly file: string;
}

/** A link/archive call, or an error surfaced when the step is reached. */
export type LinkStep = { readonly dir: string; readonly kind: LinkKind; readonly output: string } & (
  | { readonly invocation: Invocation }
  | { readonly error: ShardError }
);
