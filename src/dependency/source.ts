import type { LinkType } from "../lang/types";
import type { LinkInput } from "../toolchain/toolchain";
import type { ModuleStore } from "./store";

export interface Dependency {
  readonly kind: string;
  readonly link: LinkType | null;
  readonly name: string;
  readonly version: string | null;
}

export interface ResolveEnv {
  readonly rootPath: string;
  readonly store: ModuleStore;
  readonly gitProtocol: string;
  readonly onProgress?: (percent: number) => void;
}

/**
 * What a dependency resolves to. Deciding has no side effects beyond reading
 * the module store; fetching happens only in `install`.
 */
export type Decision =
  | { kind: "module"; path: string; name: string; install?: () => Promise<void> }
  | { kind: "link"; inputs: LinkInput[] };

/** One `depend` prefix family (git:, local:, sys:/framework:, ...). */
export interface DependencySource<D extends Dependency = Dependency> {
  readonly prefixes: readonly string[];
  /** Example specs for error hints, e.g. "local:../path". */
  readonly examples: readonly string[];
  parse(prefix: string, value: string, link: LinkType | null): D;
  /** Reuse, install, reinstall or conflict — throws on conflict. */
  decide(dep: D, env: ResolveEnv): Decision;
}
