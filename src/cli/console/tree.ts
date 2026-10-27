import chalk from "chalk";
import { pad, visibleLength } from "./format";

export interface TreeNode {
  name: string;
  /** Aligned columns between the name and the status. */
  columns: string[];
  status: string;
  dim?: boolean;
  /** Finished nodes may be folded away when the tree does not fit. */
  done: boolean;
  children: TreeNode[];
}

interface Row {
  label: string;
  columns: string[];
  status: string;
}

/**
 * Renders a header and a tree with aligned columns:
 *
 *   Building                3/5  0.4s
 *   app                     ○
 *   ├─ mid-a                ✔  0.08s
 *   └─ mid-b                ━━━━──── 1/2
 *
 * Finished subtrees fold into one line when the tree is taller than `maxLines`.
 */
export function renderTree(title: string, progress: string, root: TreeNode, maxLines: number): string[] {
  let rows = flatten(root);
  if (rows.length + 1 > maxLines) rows = flatten(foldFinished(root));

  let more = 0;
  if (rows.length + 1 > maxLines) {
    const keep = Math.max(1, maxLines - 2);
    more = rows.length - keep;
    rows = rows.slice(0, keep);
  }

  const labelWidth = Math.max(visibleLength(title), ...rows.map(r => visibleLength(r.label)));
  const columnCount = Math.max(0, ...rows.map(r => r.columns.length));
  const widths = Array.from({ length: columnCount }, (_, i) =>
    Math.max(0, ...rows.map(r => visibleLength(r.columns[i] ?? ""))));
  const columnsWidth = widths.reduce((sum, w) => sum + w + 2, 0);

  const lines = [` ${pad(chalk.bold(title), labelWidth + columnsWidth)}  ${chalk.dim(progress)}`];
  for (const row of rows) {
    const columns = widths.map((w, i) => pad(row.columns[i] ?? "", w) + "  ").join("");
    lines.push(` ${pad(row.label, labelWidth)}  ${columns}${row.status}`.trimEnd());
  }
  if (more > 0) lines.push(` ${chalk.dim(`… ${more} more`)}`);
  return lines;
}

function flatten(root: TreeNode): Row[] {
  const rows: Row[] = [];
  const walk = (node: TreeNode, branch: string, indent: string): void => {
    const name = node.dim ? chalk.dim(node.name) : node.name;
    rows.push({ label: chalk.dim(branch) + name, columns: node.columns, status: node.status });
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      walk(child, indent + (last ? "└─ " : "├─ "), indent + (last ? "   " : "│  "));
    });
  };
  walk(root, "", "");
  return rows;
}

function foldFinished(node: TreeNode): TreeNode {
  if (node.children.length > 0 && allDone(node)) {
    return { ...node, name: `${node.name} ${chalk.dim(`+${countDescendants(node)}`)}`, children: [] };
  }
  return { ...node, children: node.children.map(foldFinished) };
}

function allDone(node: TreeNode): boolean {
  return node.done && node.children.every(allDone);
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

export function bar(done: number, total: number, width = 12): string {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return chalk.cyan("━".repeat(filled)) + chalk.dim("─".repeat(width - filled));
}
