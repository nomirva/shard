import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { Sandbox, git, type RunSnapshot } from "./harness";

/*
 * The plugin core (SHARD_ENGINE=core, shard.ts) against the old pipeline
 * (shard.json) on the same module: the same toolchain calls, the same files
 * on disk, the same exit status and program output.
 */

const TIMEOUT = 120_000;

interface Outcome {
  status: number | null;
  stdout: string;
  invocations: string[];
  files: string[];
  logs: Record<string, string | null>;
}

type Engine = "old" | "core";

function outcome(sb: Sandbox, rel: string, r: RunSnapshot): Outcome {
  const files = sb.tree(rel).filter(f => !/^\.shard\/(cache\.json|core\/)/.test(f));
  return {
    status: r.status,
    stdout: r.stdout,
    // Order differs once tasks run in parallel; the set of calls must not.
    invocations: r.invocations.map(i => i.join(" ")).sort(),
    // Cache files differ in format between the engines.
    files,
    logs: Object.fromEntries(files.filter(f => f.endsWith(".log")).map(f => [f, sb.read(`${rel}/${f}`)])),
  };
}

function buildWith(sb: Sandbox, engine: Engine, rel: string, flags: string[] = []): Outcome {
  const env: Record<string, string> = engine === "core" ? { SHARD_ENGINE: "core" } : {};
  return outcome(sb, rel, sb.run(["build", sb.path(rel), ...flags], sb.dir, env));
}

function runEngine(name: string, engine: Engine, rel: string, flags: string[], setup?: (sb: Sandbox) => void): Outcome {
  const sb = new Sandbox(`engines-${name}-${engine}`);
  setup?.(sb);
  return buildWith(sb, engine, rel, flags);
}

/**
 * Runs `steps` on a fresh sandbox per engine; every step's outcome must match.
 * Only compile calls are compared: the old pipeline relinks on every build,
 * the core skips an up-to-date link. Links show in the files and the output.
 */
function sameSteps(name: string, steps: (sb: Sandbox, build: (rel: string, ...flags: string[]) => Outcome) => Outcome[]): void {
  test(name, () => {
    const run = (engine: Engine) => {
      const sb = new Sandbox(`engines-${name.replace(/[^a-z0-9]+/gi, "-")}-${engine}`);
      return steps(sb, (rel, ...flags) => buildWith(sb, engine, rel, flags))
        .map(o => ({ ...o, invocations: o.invocations.filter(i => i.includes(" -c ")) }));
    };
    expect(run("core")).toEqual(run("old"));
  }, TIMEOUT);
}

function same(name: string, rel: string, flags: string[] = [], setup?: (sb: Sandbox) => void): void {
  test(`${name}: ${[rel, ...flags].join(" ")}`, () => {
    const old = runEngine(name, "old", rel, flags, setup);
    const core = runEngine(name, "core", rel, flags, setup);
    expect(core).toEqual(old);
  }, TIMEOUT);
}

describe("core engine matches the old pipeline", () => {
  same("hello", "examples/hello", ["--start"]);
  same("profiles", "examples/profiles", ["--start"]);
  same("profile-override", "examples/profiles", ["--profile", "tiny", "--start"]);
  same("app-greet", "examples/app", ["--def", "GREET", "--start"]);
  same("app-math", "examples/app", ["--def", "MATH,EXTRA=5", "--start"]);
  same("app-no-variant", "examples/app");
  same("app-std", "examples/app-std", ["--start"]);
  same("lib-greet", "examples/lib-greet");
  same("lib-std", "examples/lib-std");
  same("lib-math", "examples/lib-math");
  same("app-hdr", "fixtures/app-hdr", ["--start"]);
  same("sysdeps", "fixtures/sysdeps", ["--start"]);
  same("codegen", "examples/codegen", ["--start"]);

  sameSteps("prebuild and postbuild hooks", (sb, build) => {
    const scripts = { prebuild: "echo pre >> hook.log", postbuild: "echo post >> hook.log" };
    sb.write("hooks/shard.json", JSON.stringify({ scripts }));
    sb.write("hooks/shard.ts", `export default { scripts: ${JSON.stringify(scripts)} };`);
    sb.write("hooks/src/main.c", "int main(void) { return 0; }\n");
    const ok = build("hooks");
    sb.write("hooks/src/main.c", "int main(void) { return nope; }\n");
    const broken = build("hooks");
    return [ok, { ...broken, stdout: "" }];
  });

  sameSteps("git dependencies: install, reuse, upgrade, conflict", (sb, build) => {
    const remotes = sb.path("remotes");
    const work = sb.path("remotes/work");
    sb.write("remotes/work/include/gitlib.h", sb.read("fixtures/gitlib/include/gitlib.h")!);
    sb.write("remotes/work/src/gitlib.c", sb.read("fixtures/gitlib/src/gitlib.c")!);
    const setVersion = (v: number) => {
      sb.write("remotes/work/shard.json", JSON.stringify({ imports: ["include"], exports: ["include"], options: { defines: [`GITLIB_VERSION=${v}`] } }));
      sb.write("remotes/work/shard.ts", `export default { c: { imports: ["include"], exports: ["include"], defines: ["GITLIB_VERSION=${v}"] } };`);
    };
    git(work, "init", "-q", "-b", "main");
    setVersion(100);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "v1.0.0");
    git(work, "tag", "v1.0.0");
    setVersion(120);
    git(work, "commit", "-q", "-am", "v1.2.0");
    git(work, "tag", "v1.2.0");
    git(remotes, "clone", "-q", "--bare", work, "gitlib.git");

    const app = "fixtures/app-git";
    const depend = (version: string) => {
      sb.write(`${app}/shard.json`, JSON.stringify({ depend: [`git:${remotes}/gitlib@${version}`] }));
      sb.write(`${app}/shard.ts`, `export default ({ git }) => ({ dependencies: [git(${JSON.stringify(`${remotes}/gitlib`)}, { version: "${version}" })] });`);
    };
    const steps: Outcome[] = [];
    for (const version of ["v1.0.0", "v1.0.0", "v1.2.0", "v1.0.0", "v2.0.0"]) {
      depend(version);
      const result = build(app, "--git-protocol", "file", "--start");
      // Error rendering is the CLI's job and still differs; status and effects must not.
      steps.push(result.status === 0 ? result : { ...result, stdout: "" });
    }
    return steps;
  });
});

describe("core engine fixes", () => {
  test("a prebuilt dependency links (the old pipeline rejects it)", () => {
    const setup = (sb: Sandbox) => {
      mkdirSync(sb.path("fixtures/prebuilt/target"), { recursive: true });
      writeFileSync(sb.path("pb.c"), "int pb_value(void) { return 7; }\n");
      spawnSync("clang", ["-c", sb.path("pb.c"), "-o", sb.path("pb.o")]);
      spawnSync("ar", ["rcs", sb.path("fixtures/prebuilt/target/libpb.a"), sb.path("pb.o")]);
    };
    expect(runEngine("prebuilt", "old", "fixtures/app-prebuilt", ["--start"], setup).status).toBe(1);
    const core = runEngine("prebuilt", "core", "fixtures/app-prebuilt", ["--start"], setup);
    expect({ status: core.status, stdout: core.stdout }).toEqual({ status: 0, stdout: "pb = 7\n" });
  }, TIMEOUT);

  test("an unchanged rebuild calls no tools; a header edit recompiles only what includes it", () => {
    const sb = new Sandbox("engines-rebuild-core");
    const env = { SHARD_ENGINE: "core" };
    const build = () => sb.run(["build", sb.path("examples/app-std")], sb.dir, env);
    expect(build().status).toBe(0);
    expect(build().invocations).toEqual([]);

    const header = "examples/lib-std/include/calc.h";
    sb.write(header, sb.read(header)! + "\n/* touched */\n");
    const compiled = build().invocations.filter(i => i.includes("-c")).map(i => i.at(-4));
    expect(compiled.sort()).toEqual(["$SB/examples/app-std/src/main.c", "$SB/examples/lib-std/src/calc.c"]);
  }, TIMEOUT);
});
