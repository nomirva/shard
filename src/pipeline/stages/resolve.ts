import { Resolver } from "../../dependency/resolver";
import type { TargetGraph } from "../../target/graph";
import type { DeclaredTarget, ResolvedTarget } from "../../target/target";
import type { Stage } from "../pipeline";

/** Installs the dependency tree and links it into a graph. */
export const resolve: Stage<DeclaredTarget, TargetGraph<ResolvedTarget>> = {
  name: "resolve",
  run: (root, ws) => new Resolver(ws).resolve(root),
};
