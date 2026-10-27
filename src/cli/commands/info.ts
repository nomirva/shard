import chalk from "chalk";
import { declaredTree, type DepTreeNode } from "../../dependency/tree";
import { privateIncludes, scanContent } from "../../target/content";
import { deriveShape } from "../../target/shape";
import { DIRS } from "../../workspace/layout";
import { createConsole } from "../console/session";
import { pad, rel } from "../console/format";
import { openWorkspace } from "./workspace";

/** Module card on stdout; `--tree` expands the whole dependency tree found on disk. */
export function infoCommand(path: string, flags: { tree?: boolean } = {}): void {
  const ws = openWorkspace(path, createConsole(), false);
  const target = ws.declareRoot();
  const content = scanContent(target.path, target.manifest, DIRS.TARGET);
  const deps = declaredTree(ws, target, flags.tree ? Infinity : 1);
  const shape = deriveShape(content, target.name);
  const { options } = target.manifest;

  const rows: [string, string][] = [
    ["path", rel(target.path)],
    ["include", privateIncludes(target.path, target.manifest, content).map(rel)[0] ?? "(none)"],
    ["standard", options.standard?.version ?? "—"],
    ["profile", options.profile ?? "release (default)"],
  ];

  const out: string[] = ["", ` ${chalk.bold(target.manifest.name ?? target.name)} ${chalk.dim("· " + shape)}`];
  for (const [label, value] of rows) out.push(`   ${chalk.dim(pad(label, 12))}${value}`);
  out.push(`   ${chalk.dim(pad("dependencies", 12))}${deps.length === 0 ? "none" : ""}`);
  out.push(...treeLines(deps, "     "));
  out.push("");
  console.log(out.join("\n"));
}

function treeLines(nodes: DepTreeNode[], prefix: string): string[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1;
    const branch = chalk.dim(last ? "└─ " : "├─ ");
    const lines = [prefix + branch + nodeLabel(node)];
    lines.push(...treeLines(node.children, prefix + chalk.dim(last ? "   " : "│  ")));
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
