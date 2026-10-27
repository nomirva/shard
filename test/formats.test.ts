import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { Sandbox } from "./harness";

const TIMEOUT = 120_000;

type Format = "shard.ts" | "shard.json";

function buildWith(name: string, format: Format, rel: string, flags: string[]) {
  const sb = new Sandbox(`formats-${name}-${format.replace(".", "-")}`);
  const drop = format === "shard.ts" ? "shard.json" : "shard.ts";
  for (const f of sb.tree()) if (f === drop || f.endsWith(`/${drop}`)) rmSync(sb.path(f));
  const r = sb.run(["build", sb.path(rel), ...flags]);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    invocations: r.invocations,
    files: sb.tree(rel).filter(f => !f.endsWith(".json") && !f.endsWith("shard.ts")),
  };
}

function same(name: string, rel: string, flags: string[] = []): void {
  test(`${name}: ${[rel, ...flags].join(" ")}`, () => {
    expect(buildWith(name, "shard.ts", rel, flags)).toEqual(buildWith(name, "shard.json", rel, flags));
  }, TIMEOUT);
}

describe("shard.ts and shard.json build the same", () => {
  same("hello", "examples/hello", ["--start"]);
  same("profiles", "examples/profiles", ["--profile", "tiny", "--start"]);
  same("app-greet", "examples/app", ["--def", "GREET", "--start"]);
  same("app-math", "examples/app", ["--def", "MATH,EXTRA=5", "--start"]);
  same("app-no-variant", "examples/app");
  same("app-std", "examples/app-std", ["--start"]);
  same("app-std-c89", "examples/app-std", ["--def", "C89"]);
  same("lib-greet", "examples/lib-greet");
  same("lib-std", "examples/lib-std");
  same("lib-math", "examples/lib-math");
  same("codegen", "examples/codegen", ["--start"]);
  same("app-hdr", "fixtures/app-hdr", ["--start"]);
  same("sysdeps", "fixtures/sysdeps", ["--start"]);
});
