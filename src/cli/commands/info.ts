import chalk from "chalk";
import type { DeclaredEdge, InitListener } from "../../core";
import { C, C_MODULES } from "../../plugins/c";
import { optional } from "../../plugins/c/model";
import { privateIncludes } from "../../target/content";
import { createConsole } from "../console/session";
import { pad, rel } from "../console/format";
import { openBuild } from "../engine";

interface DepTreeNode {
  name: string;
  source: string;
  spec: string;
  link: string | null;
  /** missing: not on disk / not installed yet; repeat: shown earlier in the tree. */
  status: "ok" | "missing" | "repeat" | "error";
  error?: string;
  children: DepTreeNode[];
}

/** Module card on stdout; `--tree` expands the whole dependency tree found on disk. Nothing is fetched. */
export async function infoCommand(path: string, flags: { tree?: boolean } = {}): Promise<void> {
  const roots: DepTreeNode[] = [];
  const nodes = new Map<number, DepTreeNode>();
  const listener: InitListener = {
    declared: (_module, edges) => {
      for (const edge of edges) {
        const system = edge.info.source === "system" || edge.info.source === "framework";
        const node: DepTreeNode = {
          // System libraries are named by what they link ("m"), like in build output.
          name: system ? edge.info.spec : edge.info.name,
          source: edge.info.source,
          spec: system ? "" : edge.info.spec,
          link: edge.info.link,
          status: "ok",
          children: [],
        };
        nodes.set(edge.id, node);
        (edge.parentId === null ? roots : nodes.get(edge.parentId)!.children).push(node);
      }
    },
    done: (edge, result) => {
      const node = nodeOf(nodes, edge);
      if (result.target.kind === "missing") node.status = "missing";
      else if (result.duplicate) node.status = "repeat";
    },
    failed: (edge, error) => {
      const node = nodeOf(nodes, edge);
      node.status = "error";
      node.error = (error as Error).message;
    },
  };

  const { root } = await openBuild(path, { reporter: createConsole(), dryRun: true, listener });
  const ext = root.extensions.get(C);
  const model = root.services.get(C_MODULES).modelOf(root);

  const rows: [string, string][] = [
    ["path", rel(root.dir)],
    ["include", privateIncludes(root.dir, { imports: optional(ext.imports) }, model.content).map(rel)[0] ?? "(none)"],
    ["standard", optional(ext.standard)?.version ?? "—"],
    ["profile", optional(ext.profile) ?? "release (default)"],
  ];

  const deps = flags.tree ? roots : roots.map(n => ({ ...n, children: [] }));
  const out: string[] = ["", ` ${chalk.bold(root.name)} ${chalk.dim("· " + model.shape)}`];
  for (const [label, value] of rows) out.push(`   ${chalk.dim(pad(label, 12))}${value}`);
  out.push(`   ${chalk.dim(pad("dependencies", 12))}${deps.length === 0 ? "none" : ""}`);
  out.push(...treeLines(deps, "     "));
  out.push("");
  console.log(out.join("\n"));
}

function nodeOf(nodes: Map<number, DepTreeNode>, edge: DeclaredEdge): DepTreeNode {
  return nodes.get(edge.id)!;
}

function treeLines(nodes: DepTreeNode[], prefix: string): string[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1;
    const branch = chalk.dim(last ? "└─ " : "├─ ");
    const lines = [prefix + branch + nodeLabel(node)];
    lines.push(...treeLines(node.status === "repeat" ? [] : node.children, prefix + chalk.dim(last ? "   " : "│  ")));
    return lines;
  });
}

function nodeLabel(node: DepTreeNode): string {
  const parts = [chalk.bold(node.name), chalk.dim(node.source), node.spec].filter(Boolean);
  if (node.link) parts.push(chalk.dim(node.link));
  if (node.status === "missing") parts.push(chalk.yellow("not installed"));
  if (node.status === "repeat") parts.push(chalk.dim("(see above)"));
  if (node.status === "error") parts.push(chalk.red(node.error ?? "error"));
  return parts.join("  ");
}
