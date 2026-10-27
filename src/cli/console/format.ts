import { homedir } from "os";
import { relative, sep } from "path";

import { stripAnsi } from "../../utils/text";

export { stripAnsi };

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleLength(s)));
}

export function fit(s: string, columns: number): string {
  const max = Math.max(10, columns - 1);
  return visibleLength(s) <= max ? s : stripAnsi(s).slice(0, max - 1) + "…";
}

export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function rel(path: string): string {
  const r = relative(process.cwd(), path) || ".";
  if (!r.startsWith(`..${sep}..${sep}..`)) return r;
  const home = homedir();
  return path.startsWith(home + sep) ? "~" + path.slice(home.length) : path;
}

export function shortenPaths(text: string): string {
  const prefix = (process.cwd() + sep).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|[\\s'"(=]|\\x1b\\[[0-9;]*m)${prefix}`, "gm"), "$1");
}

export function shortVersion(full: string): string {
  return full.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? full;
}

export function indentBlock(text: string, prefix: string): string {
  return text.replace(/\s+$/, "").split("\n").map(line => prefix + line).join("\n");
}
