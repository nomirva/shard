import { existsSync } from "fs";
import type { Workspace } from "../workspace/workspace";
import type { DeclaredTarget } from "../target/target";
import { parseDependency, sourceLabel } from "./parse";
import { sourceFor } from "./registry";
import { ModuleStore } from "./store";

export interface DepTreeNode {
  name: string;
  source: string;
  spec: string;
  link: string | null;
  /** missing: not on disk / not installed yet; repeat: shown earlier in the tree. */
  status: "ok" | "missing" | "repeat" | "error";
  error?: string;
  children: DepTreeNode[];
}

/**
 * The declared dependency tree as far as it is on disk. Uses `decide` only,
 * so nothing is fetched or installed.
 */
export function declaredTree(ws: Workspace, root: DeclaredTarget, maxDepth: number): DepTreeNode[] {
  const store = new ModuleStore(ws.modulesDir);
  const seen = new Set([root.path]);

  const walk = (target: DeclaredTarget, chain: string[], depth: number): DepTreeNode[] =>
    target.manifest.depend.map((spec): DepTreeNode => {
      const dep = parseDependency(spec);
      const source = sourceFor(dep.kind)!;
      const system = dep.kind === "sys" || dep.kind === "framework";
      const node: DepTreeNode = {
        // System libraries are named by what they link ("m"), like in build output.
        name: system ? source.spec(dep) : dep.name,
        source: sourceLabel(dep),
        spec: system ? "" : source.spec(dep),
        link: dep.link,
        status: "ok",
        children: [],
      };

      let decision;
      try {
        decision = source.decide(dep, {
          rootPath: ws.rootPath,
          store,
          gitProtocol: ws.settings.resolve.gitProtocol,
          requestedBy: chain,
        });
      } catch (e) {
        return { ...node, status: "error", error: (e as Error).message };
      }
      if (decision.kind === "link") return node;
      if (decision.install || !existsSync(decision.path)) return { ...node, status: "missing" };
      if (seen.has(decision.path)) return { ...node, status: "repeat" };
      seen.add(decision.path);

      if (depth < maxDepth) {
        const child = ws.declare(decision.path, decision.name);
        node.children = walk(child, [...chain, child.name], depth + 1);
      }
      return node;
    });

  return walk(root, [root.name], 1);
}
