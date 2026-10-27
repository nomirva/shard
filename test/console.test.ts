import { describe, expect, test } from "bun:test";
import { ConsoleReporter } from "../src/cli/console/reporter";
import { ShardError } from "../src/utils/errors";
import type { DepInfo, ReportEvent, TargetSummary, TreeShape } from "../src/report/events";

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
  return lines.join("\n");
}

interface Console {
  ui: ConsoleReporter;
  out: () => string;
  writes: string[];
  tick: (ms: number) => void;
}

function record(options: { live: boolean; verbose?: boolean; rows?: number }): Console {
  const writes: string[] = [];
  let clock = 0;
  const ui = new ConsoleReporter({
    live: options.live,
    verbose: options.verbose ?? false,
    write: s => writes.push(s),
    columns: () => 120,
    rows: () => options.rows ?? 40,
    now: () => clock,
    graceMs: 0,
  });
  return { ui, writes, out: () => screen(writes.join("")), tick: ms => { clock += ms; } };
}

const dep = (id: number, parentId: number | null, name: string, source: string, spec: string, link: string | null = null): DepInfo =>
  ({ id, parentId, name, source, spec, link });

const target = (name: string, shape: string, files: number): TargetSummary =>
  ({ name, shape, standard: "c11", profile: "release", files });

const tree: TreeShape = {
  name: "app", repeat: false, children: [
    { name: "mid-a", repeat: false, children: [{ name: "leaf", repeat: false, children: [] }] },
    { name: "gitlib", repeat: false, children: [] },
    { name: "mid-b", repeat: false, children: [{ name: "leaf", repeat: true, children: [] }] },
  ],
};

const midA = dep(0, null, "mid-a", "local", "../mid-a");
const gitlib = dep(1, null, "gitlib", "git", "v1.2.0");
const midB = dep(2, null, "mid-b", "local", "../mid-b");
const leaf = dep(3, 0, "leaf", "local", "../leaf", "static");
const m = dep(4, 0, "sys:m", "system", "m");
const leafAgain = dep(5, 2, "leaf", "local", "../leaf");

const resolving: ReportEvent[] = [
  { type: "run.start", command: "build", details: ["shard 0.1.0", "clang 21.0.0", "arm64-darwin"] },
  { type: "deps.declared", parent: "app", parentId: null, deps: [midA, gitlib, midB] },
  { type: "dep.start", id: 0 },
  { type: "dep.done", dep: midA, action: "local", duration: 1, path: "/x/mid-a", warnings: [] },
  { type: "deps.declared", parent: "mid-a", parentId: 0, deps: [leaf, m] },
  { type: "dep.start", id: 3 },
  { type: "dep.done", dep: leaf, action: "local", duration: 1, path: "/x/leaf", warnings: [] },
  { type: "dep.start", id: 4 },
  { type: "dep.done", dep: m, action: "linked", duration: 0, flags: ["-lm"], warnings: ["static linking unavailable on macOS, linking dynamically"] },
  { type: "dep.start", id: 1 },
  { type: "dep.progress", id: 1, percent: 45 },
];

const resolved: ReportEvent[] = [
  { type: "dep.done", dep: gitlib, action: "upgraded", previous: "v1.0.0", duration: 420, path: "/x/modules/gitlib@v1.2.0", warnings: [] },
  { type: "dep.start", id: 2 },
  { type: "dep.done", dep: midB, action: "local", duration: 1, path: "/x/mid-b", warnings: [] },
  { type: "deps.declared", parent: "mid-b", parentId: 2, deps: [leafAgain] },
  { type: "dep.start", id: 5 },
  { type: "dep.done", dep: leafAgain, action: "duplicate", duration: 0, path: "/x/leaf", warnings: [] },
  { type: "resolve.end" },
];

const compile = (t: string, file: string, status: "compiled" | "cached", diagnostics = ""): ReportEvent =>
  ({ type: "compile", target: t, file, status, duration: 20, command: `clang -c ${file}`, diagnostics });

const building: ReportEvent[] = [
  {
    type: "build.start",
    targets: [target("leaf", "library", 2), target("mid-a", "library", 1), target("gitlib", "library", 1),
      target("mid-b", "library", 2), target("app", "executable", 1)],
    tree,
  },
  { type: "target.start", target: target("leaf", "library", 2) },
  compile("leaf", "src/leaf.c", "compiled"),
  compile("leaf", "src/nested.c", "compiled"),
  { type: "target.end", target: "leaf", duration: 210, outputs: ["/x/.shard/leaf/target/leaf.a"] },
  { type: "target.start", target: target("mid-a", "library", 1) },
  compile("mid-a", "src/mid_a.c", "compiled"),
  { type: "target.end", target: "mid-a", duration: 80, outputs: [] },
  { type: "target.start", target: target("gitlib", "library", 1) },
  compile("gitlib", "src/gitlib.c", "cached"),
  { type: "target.end", target: "gitlib", duration: 5, outputs: [] },
  { type: "target.start", target: target("mid-b", "library", 2) },
  compile("mid-b", "src/mid_b.c", "compiled", "src/mid_b.c:3:5: warning: unused variable 'x'\n"),
  { type: "compile.start", target: "mid-b", file: "src/extra.c" },
];

const built: ReportEvent[] = [
  compile("mid-b", "src/extra.c", "cached"),
  { type: "target.end", target: "mid-b", duration: 60, outputs: [] },
  { type: "target.start", target: target("app", "executable", 1) },
  compile("app", "src/main.c", "compiled"),
  { type: "link", target: "app", kind: "executable", output: "/x/target/app", duration: 40, command: "clang -o app" },
  { type: "target.end", target: "app", duration: 90, outputs: ["/x/target/app"] },
  { type: "run.end", command: "build", subject: "app", artifacts: ["/x/target/app"] },
];

function play(c: Console, events: ReportEvent[]): void {
  for (const event of events) {
    c.ui.emit(event);
    c.tick(100);
  }
}

describe("console reporter", () => {
  test("resolve phase: live tree with pending deps and clone progress", () => {
    const c = record({ live: true });
    play(c, resolving);
    expect(c.out()).toMatchSnapshot();
  });

  test("build phase: tree fills bottom-up, warnings stay above it", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved, ...building]);
    expect(c.out()).toMatchSnapshot();
  });

  test("finished run: tree disappears, summary remains", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved, ...building, ...built]);
    expect(c.out()).toMatchSnapshot();
  });

  test("short terminal: finished subtrees fold", () => {
    const c = record({ live: true, rows: 7 });
    play(c, [...resolving, ...resolved, ...building]);
    expect(c.out()).toMatchSnapshot();
  });

  test("error during resolve folds the tree into a path", () => {
    const c = record({ live: true });
    play(c, resolving);
    c.ui.error(new ShardError("conflict", "v1.2.0 requested by app, but v2.0.0 is installed",
      "only one version of a module can be installed at a time"));
    expect(c.out()).toMatchSnapshot();
  });

  test("compile error: diagnostics and one statement", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved, ...building.slice(0, 2)]);
    c.ui.emit({
      type: "compile", target: "leaf", file: "src/leaf.c", status: "failed", duration: 20, command: "clang",
      diagnostics: "src/leaf.c:1:1: error: unknown type name 'nope'\n1 error generated.\n",
    });
    c.ui.error(new ShardError("build", "leaf: 1 error"));
    expect(c.out()).toMatchSnapshot();
  });

  test("plain output: no tree, one line per finished node", () => {
    const c = record({ live: false });
    play(c, [...resolving, ...resolved, ...building, ...built]);
    expect(c.writes.join("")).not.toContain("\x1b[");
    expect(c.out()).toMatchSnapshot();
  });

  test("verbose output lists everything", () => {
    const c = record({ live: false, verbose: true });
    play(c, [...resolving, ...resolved, ...building, ...built]);
    expect(c.out()).toMatchSnapshot();
  });

  test("preload hook gets its own Preparing tree", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved,
      { type: "hook.start", target: "mid-a", hook: "preload", command: "sh gen.sh" }]);
    expect(c.out()).toMatchSnapshot();
  });

  test("build hooks are rows under their module", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved, ...building.slice(0, 5),
      { type: "target.start", target: target("mid-a", "library", 1) },
      { type: "hook.start", target: "mid-a", hook: "prebuild", command: "python3 tools/generate_sources.py --out build/generated" }]);
    const running = c.out();
    play(c, [{ type: "hook", target: "mid-a", hook: "prebuild", command: "sh gen.sh", duration: 30, output: "" }]);
    const done = c.out();
    expect(running).toContain("▸ prebuild");
    expect(done).not.toContain("prebuild");
    expect({ running, done }).toMatchSnapshot();
  });

  test("failing hook names module and hook", () => {
    const c = record({ live: true });
    play(c, [...resolving, ...resolved, ...building.slice(0, 5),
      { type: "target.start", target: target("mid-a", "library", 1) },
      { type: "hook.start", target: "mid-a", hook: "prebuild", command: "sh gen.sh" }]);
    c.ui.error(new ShardError("script", 'Script "prebuild" failed (exit code 1)', undefined, {
      details: [["command", "sh gen.sh"], ["cwd", "/x/mid-a"]], output: "gen.sh: line 3: python: not found",
    }));
    expect(c.out()).toMatchSnapshot();
  });

  test("cached rebuild is a single line", () => {
    const c = record({ live: true });
    play(c, [
      { type: "run.start", command: "build", details: [] },
      { type: "build.start", targets: [target("app", "executable", 1)], tree: { name: "app", repeat: false, children: [] } },
      { type: "target.start", target: target("app", "executable", 1) },
      compile("app", "src/main.c", "cached"),
      { type: "target.end", target: "app", duration: 3, outputs: ["/x/target/app"] },
      { type: "run.end", command: "build", subject: "app", artifacts: ["/x/target/app"] },
    ]);
    expect(c.out()).toMatchSnapshot();
  });
});
