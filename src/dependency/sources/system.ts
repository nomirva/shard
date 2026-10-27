import type { LinkType } from "../../lang/types";
import type { Decision, Dependency, DependencySource } from "../source";

export interface SystemDependency extends Dependency {
  kind: "sys" | "framework";
  value: string;
}

/** Libraries provided by the system: nothing to install, the toolchain turns them into link flags. */
export const systemSource: DependencySource<SystemDependency> = {
  prefixes: ["sys", "framework"],
  examples: ["sys:z", "framework:Cocoa"],

  parse(prefix: string, value: string, link: LinkType | null): SystemDependency {
    const kind = prefix as SystemDependency["kind"];
    return { kind, link, name: `${kind}:${value}`, version: null, value };
  },

  decide(dep: SystemDependency): Decision {
    return {
      kind: "link",
      inputs: [{ kind: dep.kind === "sys" ? "library" : "framework", name: dep.value, link: dep.link }],
    };
  },
};
