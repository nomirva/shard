import { describe, expect, test } from "bun:test";
import { resolveConditionals } from "../src/manifest/conditional";
import { buildManifest } from "../src/manifest/manifest";
import { parseDependency } from "../src/dependency/parse";
import { makePin, reconcile, type GitPin } from "../src/dependency/sources/git/pin";
import { dominates, olderStandard, oldestStandard } from "../src/lang/standards";

const ctx = { compiler: "clang", platform: "darwin", arch: "arm64", defines: ["A", "B=2"] };

const capture = (fn: () => unknown): unknown => {
  try {
    return fn();
  } catch (e) {
    return { error: (e as Error).message, hint: (e as { hint?: string }).hint };
  }
};

describe("conditionals", () => {
  test("resolution and merge order", () => {
    expect(resolveConditionals({
      depend: ["x"],
      options: { defines: ["BASE"] },
      "?platform:darwin": { depend: ["mac"], options: { defines: ["MAC"], nested: { a: 1 } } },
      "?platform!linux": { options: { nested: { b: 2 } } },
      "?arch:x64": { depend: ["never"] },
      "?compiler:clang": { name: "clang-name" },
      "?define:A": { "?define:B": { depend: ["a-and-b"] } },
      "?define:B": { version: "1.0.0" },
      "?define!C": { target: "no-c" },
      "?define:C": { target: "c" },
    }, ctx)).toMatchSnapshot();
  });
});

describe("manifest", () => {
  test("normalization", () => {
    expect(buildManifest({}, ctx)).toMatchSnapshot();
    expect(buildManifest({
      name: "n", version: "1", target: "t", depend: ["a", 3, "b"], scripts: { x: "y" },
      options: { profile: "debug", standard: "gnu11", warnings: "extra", defines: ["D"] },
    }, ctx)).toMatchSnapshot();
    expect(buildManifest({ options: { standard: { version: "c99", support: "c89", pedantic: "error" } } }, ctx))
      .toMatchSnapshot();
  });

  test("errors", () => {
    expect([
      capture(() => buildManifest({ options: { profile: "turbo" } }, ctx)),
      capture(() => buildManifest({ options: { standard: "c++17" } }, ctx)),
      capture(() => buildManifest({ options: { standard: "c2x" } }, ctx)),
      capture(() => buildManifest({ options: { standard: 11 } }, ctx)),
      capture(() => buildManifest({ options: { standard: { version: 11 } } }, ctx)),
      capture(() => buildManifest({ options: { standard: { support: 11 } } }, ctx)),
      capture(() => buildManifest({ options: { standard: { pedantic: "yes" } } }, ctx)),
    ]).toMatchSnapshot();
  });
});

describe("dependency parsing", () => {
  test("forms", () => {
    expect([
      "git:user/repo",
      "git:user/repo.git@main",
      "git:user/repo@v1.2.3+static",
      "git:user/repo@1.2.3+shared",
      "git:owner/mono//libs/mylib@v1.0.0+dynamic",
      "git:owner/mono@v1.0.0//libs/mylib",
      "git:owner/mono//libs/mylib",
      "local:../lib/",
      "local:../lib+shared",
      "sys:z+static",
      "framework:Cocoa",
      "nope",
      "foo:bar",
    ].map(s => capture(() => parseDependency(s)))).toMatchSnapshot();
  });
});

describe("git pins", () => {
  test("reconcile matrix", () => {
    const pins: GitPin[] = [undefined, "main", "dev", "v1.0.0", "v1.2.0", "1.2.0", "v2.0.0"].map(makePin);
    const rows = pins.flatMap(req => pins.map(inst => ({ req, inst, result: capture(() => reconcile(req, inst)) })));
    expect(rows).toMatchSnapshot();
  });
});

describe("standards", () => {
  test("ordering", () => {
    expect([
      olderStandard(undefined, "c11"),
      olderStandard("c11", undefined),
      olderStandard("c99", "c11"),
      olderStandard("gnu11", "c11"),
      olderStandard("c11", "gnu11"),
      oldestStandard(["gnu17", "c11", "gnu11"]),
      dominates("c11", "c99"),
      dominates("c99", "c11"),
      dominates("c11", "gnu99"),
      dominates("gnu11", "gnu99"),
      dominates("gnu11", "c11"),
    ]).toMatchSnapshot();
  });
});
