import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { Sandbox } from "./harness";

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
}

function runEngine(name: string, engine: "old" | "core", rel: string, flags: string[], setup?: (sb: Sandbox) => void): Outcome {
  const sb = new Sandbox(`engines-${name}-${engine}`);
  setup?.(sb);
  const env: Record<string, string> = engine === "core" ? { SHARD_ENGINE: "core" } : {};
  const r = sb.run(["build", sb.path(rel), ...flags], sb.dir, env);
  return {
    status: r.status,
    stdout: r.stdout,
    // Order differs once tasks run in parallel; the set of calls must not.
    invocations: r.invocations.map(i => i.join(" ")).sort(),
    // Cache files differ in format between the engines.
    files: sb.tree(rel).filter(f => !/^\.shard\/(cache\.json|core\/)/.test(f)),
  };
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
