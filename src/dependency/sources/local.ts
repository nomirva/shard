import { basename, resolve as resolvePath } from "path";
import type { LinkType } from "../../lang/types";
import type { Decision, Dependency, DependencySource, ResolveEnv } from "../source";

export interface LocalDependency extends Dependency {
  kind: "local";
  target: string;
}

export const localSource: DependencySource<LocalDependency> = {
  prefixes: ["local"],
  examples: ["local:../path"],

  parse(_prefix: string, value: string, link: LinkType | null): LocalDependency {
    const name = basename(value.replace(/[/\\]+$/, "")) || "local";
    return { kind: "local", link, name, version: null, target: value };
  },

  decide(dep: LocalDependency, env: ResolveEnv): Decision {
    return { kind: "module", path: resolvePath(env.rootPath, dep.target), name: dep.name };
  },
};
