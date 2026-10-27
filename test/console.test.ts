import { describe, expect, test } from "bun:test";
import { ConsoleReporter } from "../src/cli/console/reporter";
import { ShardError } from "../src/utils/errors";
import type { DepInfo, ReportEvent, TargetSummary } from "../src/report/events";

/** Replays what a terminal would show: handles "cursor up N" and "clear to end of screen". */
function screen(raw: string): string {
  const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const lines: string[] = [""];
  let row = 0;
  for (let i = 0; i < text.length; i++) {
    const esc = /^\x1b\[(\d*)([AJ])/.exec(text.slice(i));
    if (esc) {
      if (esc[2] === "A") row -= Number(esc[1] || 1);
      else { lines.length = row + 1; lines[row] = ""; }
      i += esc[0].length - 1;
      continue;
    }
    if (text[i] === "\n") {
      row++;
      if (lines[row] === undefined) lines[row] = "";
      continue;
    }
    lines[row] += text[i];
  }
  return lines.join("\n").replace(/\b\d+(\.\d+)?m?s\b/g, "<t>");
}

function record(live: boolean, verbose = false): { ui: ConsoleReporter; out: () => string; writes: string[] } {
  const writes: string[] = [];
  const ui = new ConsoleReporter({ live, verbose, write: s => writes.push(s), columns: () => 120 });
  return { ui, writes, out: () => screen(writes.join("")) };
}

const dep = (id: number, depth: number, name: string, source: string, spec: string, link: string | null = null): DepInfo =>
  ({ id, depth, name, source, spec, link });

const leaf: TargetSummary = { name: "leaf", shape: "library", standard: "c99", profile: "release", files: 2 };
const app: TargetSummary = { name: "app", shape: "executable", standard: "c11", profile: "release", files: 1 };

const buildEvents: ReportEvent[] = [
  { type: "run.start", noun: "Build", title: "shard 0.1.0", details: ["clang 21.0.0", "arm64-darwin"] },
  { type: "dep.start", dep: dep(0, 0, "leaf", "local", "../leaf", "static") },
  { type: "dep.done", dep: dep(0, 0, "leaf", "local", "../leaf", "static"), action: "local", duration: 1, path: "/x/leaf", warnings: [] },
  { type: "dep.start", dep: dep(1, 1, "gitlib", "git", "v1.2.0") },
  { type: "dep.progress", id: 1, percent: 45 },
  {
    type: "dep.done", dep: dep(1, 1, "gitlib", "git", "v1.2.0"), action: "upgraded", previous: "v1.0.0",
    duration: 420, path: "/x/modules/gitlib@v1.2.0", warnings: [],
  },
  {
    type: "dep.done", dep: dep(2, 0, "sys:m", "system", "m", "static"), action: "linked", duration: 0,
    flags: ["-lm"], warnings: ["-Bstatic unavailable on macOS, linking dynamically"],
  },
  { type: "build.start", targets: [leaf, app] },
  { type: "target.start", target: leaf },
  { type: "compile.start", target: "leaf", file: "src/leaf.c" },
  { type: "compile", target: "leaf", file: "src/leaf.c", status: "compiled", duration: 80, command: "clang -c leaf.c", diagnostics: "" },
  { type: "compile", target: "leaf", file: "src/nested.c", status: "cached", duration: 0, command: "clang -c nested.c", diagnostics: "" },
  { type: "link", target: "leaf", kind: "static", output: "/x/.shard/leaf/target/leaf.a", duration: 9, command: "ar rcs leaf.a" },
  { type: "target.end", target: "leaf", duration: 120, outputs: ["/x/.shard/leaf/target/leaf.a"] },
  { type: "target.start", target: app },
  { type: "hook", target: "app", hook: "prebuild", command: "sh gen.sh", duration: 3, output: "generated" },
  {
    type: "compile", target: "app", file: "src/main.c", status: "compiled", duration: 30, command: "clang -c main.c",
    diagnostics: "src/main.c:3:5: warning: unused variable 'x'\n",
  },
  { type: "link", target: "app", kind: "executable", output: "/x/target/app", duration: 40, command: "clang -o app" },
  { type: "target.end", target: "app", duration: 90, outputs: ["/x/target/app"] },
  { type: "run.end", label: "Built app", artifacts: ["/x/target/app"] },
];

describe("console reporter", () => {
  test("live build: one line per module, details after it", () => {
    const { ui, out } = record(true);
    for (const event of buildEvents) ui.emit(event);
    expect(out()).toMatchSnapshot();
  });

  test("live build shows a spinner line while a module compiles", () => {
    const { ui, out } = record(true);
    for (const event of buildEvents.slice(0, 10)) ui.emit(event);
    expect(out()).toContain("leaf  library     c99 · release  2 files  ⠋ src/leaf.c");
    ui.error(new Error("stop"));
  });

  test("plain build: files listed under their module", () => {
    const { ui, out, writes } = record(false);
    for (const event of buildEvents) ui.emit(event);
    expect(writes.join("")).not.toContain("\x1b[");
    expect(out()).toMatchSnapshot();
  });

  test("verbose build shows commands and hook output", () => {
    const { ui, out } = record(true, true);
    for (const event of buildEvents) ui.emit(event);
    expect(out()).toMatchSnapshot();
  });

  test("failure in the middle of a module", () => {
    const { ui, out } = record(true);
    for (const event of buildEvents.slice(0, 9)) ui.emit(event);
    ui.emit({
      type: "compile", target: "leaf", file: "src/leaf.c", status: "failed", duration: 20, command: "clang",
      diagnostics: "src/leaf.c:1:1: error: unknown type name 'nope'\n1 error generated.\n",
    });
    ui.error(new ShardError("build", "Compilation failed: leaf", undefined, { details: [["file", "/x/leaf/src/leaf.c"]] }));
    expect(out()).toMatchSnapshot();
  });

  test("structured error with hint and tool output", () => {
    const { ui, out } = record(false);
    ui.emit({ type: "dep.start", dep: dep(0, 0, "gitlib", "git", "v2.0.0") });
    ui.error(new ShardError("conflict", "Version conflict: gitlib", "one pinned state per module can be installed at a time", {
      details: [["installed", "v1.0.0   modules/gitlib@v1.0.0"], ["requested", "v2.0.0   by app → mid-a"]],
      output: "fatal: something\nsecond line",
    }));
    expect(out()).toMatchSnapshot();
  });
});
