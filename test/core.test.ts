import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CacheStore } from "../src/cache/store";
import {
  attribute, AttributeContainer, AttributeSchema, Build, extension, initialize, moduleDependency, Property, provider, scriptReader, Task,
  type Dependency, type ExecutionListener, type Plugin, type TaskContext,
} from "../src/core";
import { builtinPlugins, DEFAULT_PLUGINS } from "../src/plugins";
import { C } from "../src/plugins/c";
import type { ShardError } from "../src/utils/errors";

class MemoryCache implements CacheStore {
  readonly entries = new Map<string, string>();
  get(key: string) { return this.entries.get(key); }
  set(key: string, value: string) { this.entries.set(key, value); }
  flush() {}
}

/** Writes `text` to `file`. */
class WriteText extends Task {
  readonly text = this.input<string>("text");
  readonly file = this.outputFile("file");
  run() { writeFileSync(this.file.get(), this.text.get()); }
}

/** Concatenates `sources` into `file`; optionally reports an extra file as a discovered input. */
class Concat extends Task {
  readonly sources = this.inputFiles("sources");
  readonly header = this.input<string>("header").convention("");
  readonly file = this.outputFile("file");
  discover: string | null = null;
  run(ctx: TaskContext) {
    const parts = this.sources.get().map(f => readFileSync(f, "utf-8"));
    if (this.discover) {
      parts.push(readFileSync(this.discover, "utf-8"));
      ctx.discovered([this.discover]);
    }
    writeFileSync(this.file.get(), this.header.get() + parts.join("+"));
  }
}

class Fail extends Task {
  run(): void { throw new Error(`${this.name} failed`); }
}

class Note extends Task {
  static log: string[] = [];
  run() { Note.log.push(this.path); }
}

/** Sleeps and records how many tasks of this type ran at once. */
class Slow extends Task {
  static active = 0;
  static peak = 0;
  readonly file = this.outputFile("file");
  async run() {
    Slow.peak = Math.max(Slow.peak, ++Slow.active);
    await new Promise(r => setTimeout(r, 20));
    writeFileSync(this.file.get(), this.name);
    Slow.active--;
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "shard-core-"));
  const build = new Build(dir);
  const root = build.addModule({ name: "app", path: ":", dir, buildDir: join(dir, ".shard") });
  const cache = new MemoryCache();
  const events: string[] = [];
  const listener: ExecutionListener = { taskEnd: (task, outcome) => events.push(`${task.path} ${outcome.kind}`) };
  const run = async (requested: string[], jobs = 4) => {
    events.length = 0;
    const result = await build.run(requested, { jobs, cache, listener });
    return { result, events: [...events] };
  };
  return { dir, build, root, cache, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("providers", () => {
  test("map, zip, convention and set", () => {
    const a = new Property<number>(":a").convention(1);
    const b = new Property<number>(":b").set(provider(10));
    const sum = a.zip(b, (x, y) => x + y);
    expect(sum.get()).toBe(11);
    a.set(5);
    expect(sum.map(n => n * 2).get()).toBe(30);
  });

  test("a property without a value names itself", () => {
    expect(() => new Property<string>(":app:compile.standard").get()).toThrow(":app:compile.standard has no value");
  });
});

describe("task graph", () => {
  test("wiring an output into an input orders the tasks", () => {
    const { root, build, dir, cleanup } = setup();
    const gen = root.tasks.register("gen", WriteText, t => {
      t.text.set("generated");
      t.file.set(join(dir, "gen.txt"));
    });
    root.tasks.register("bundle", Concat, t => {
      t.sources.add(gen.flatMap(g => g.file));
      t.file.set(join(dir, "bundle.txt"));
    });
    expect(build.graph(["bundle"]).describe()).toEqual([":gen", ":bundle ← :gen"]);
    cleanup();
  });

  test("only reachable tasks are created", () => {
    const { root, build, dir, cleanup } = setup();
    let configured = false;
    root.tasks.register("unused", WriteText, () => { configured = true; });
    root.tasks.register("used", WriteText, t => {
      t.text.set("x");
      t.file.set(join(dir, "x"));
    });
    build.graph(["used"]);
    expect(configured).toBe(false);
    cleanup();
  });

  test("properties are final once the graph is built", () => {
    const { root, build, dir, cleanup } = setup();
    const task = root.tasks.register("w", WriteText, t => {
      t.text.set("x");
      t.file.set(join(dir, "x"));
    });
    build.graph(["w"]);
    expect(() => task.get().text.set("y")).toThrow(":w.text is final");
    cleanup();
  });

  test("cycles are reported with their path", () => {
    const { root, build, cleanup } = setup();
    const a = root.tasks.register("a", Note);
    const b = root.tasks.register("b", Note, t => t.dependsOn(a));
    a.configure(t => t.dependsOn(b));
    expect(() => build.graph(["a"])).toThrow("Task dependency cycle");
    cleanup();
  });

  test("configureEach reaches tasks registered later; withId waits for the plugin", () => {
    const { root, cleanup } = setup();
    const seen: string[] = [];
    root.tasks.configureEach(WriteText, t => seen.push(t.name));
    root.plugins.withId("greeter", () => seen.push("greeter applied"));

    const Greeting = extension<{ text: Property<string> }>("greeting");
    const plugin: Plugin = {
      id: "greeter",
      apply: module => {
        const ext = module.extensions.add(Greeting, { text: new Property<string>(":greeting.text").convention("hi") });
        module.tasks.register("greet", WriteText, t => t.text.set(ext.text));
      },
    };
    root.plugins.apply(plugin);
    root.plugins.apply(plugin);
    root.extensions.get(Greeting).text.set("hello");

    expect(root.tasks.named("greet").get() instanceof WriteText).toBe(true);
    expect((root.tasks.named("greet").get() as WriteText).text.get()).toBe("hello");
    expect(seen).toEqual(["greeter applied", "greet"]);
    cleanup();
  });
});

describe("execution", () => {
  test("up to date until an input, a discovered input or an output changes", async () => {
    const { root, dir, run, cleanup } = setup();
    const src = join(dir, "a.txt");
    const extra = join(dir, "extra.h");
    writeFileSync(src, "a");
    writeFileSync(extra, "h");
    root.tasks.register("bundle", Concat, t => {
      t.sources.add(src);
      t.file.set(join(dir, "out.txt"));
      t.discover = extra;
    });

    expect((await run(["bundle"])).events).toEqual([":bundle executed"]);
    expect((await run(["bundle"])).events).toEqual([":bundle up-to-date"]);

    writeFileSync(src, "b");
    expect((await run(["bundle"])).events).toEqual([":bundle executed"]);

    writeFileSync(extra, "changed");
    expect((await run(["bundle"])).events).toEqual([":bundle executed"]);

    rmSync(join(dir, "out.txt"));
    expect((await run(["bundle"])).events).toEqual([":bundle executed"]);
    expect(readFileSync(join(dir, "out.txt"), "utf-8")).toBe("b+changed");
    cleanup();
  });

  test("independent tasks run in parallel up to jobs, with the same results", async () => {
    for (const jobs of [1, 4]) {
      const { root, dir, run, cleanup } = setup();
      Slow.peak = 0;
      const parts = ["p1", "p2", "p3", "p4"].map(name =>
        root.tasks.register(name, Slow, t => t.file.set(join(dir, `${name}.txt`))));
      root.tasks.register("all", Concat, t => {
        for (const part of parts) t.sources.add(part.flatMap(p => p.file));
        t.file.set(join(dir, "all.txt"));
      });
      const { events } = await run(["all"], jobs);
      expect(Slow.peak).toBe(jobs);
      expect(events.at(-1)).toBe(":all executed");
      expect(readFileSync(join(dir, "all.txt"), "utf-8")).toBe("p1+p2+p3+p4");
      cleanup();
    }
  });

  test("a failure skips dependents, finalizers still run", async () => {
    const { root, run, cleanup } = setup();
    Note.log = [];
    const cleanupTask = root.tasks.register("cleanup", Note);
    const broken = root.tasks.register("compile", Fail, t => t.finalizedBy(cleanupTask));
    root.tasks.register("link", Note, t => t.dependsOn(broken));

    const { result, events } = await run(["link"], 1);
    expect(events).toEqual([":compile failed", ":link skipped", ":cleanup executed"]);
    expect((result.failures[0] as Error).message).toBe("compile failed");
    expect(Note.log).toEqual([":cleanup"]);
    cleanup();
  });

  test("a finalizer is skipped when the task it finalizes never ran", async () => {
    const { root, run, cleanup } = setup();
    const after = root.tasks.register("after", Note);
    const broken = root.tasks.register("broken", Fail);
    const target = root.tasks.register("target", Note, t => t.dependsOn(broken).finalizedBy(after));
    void target;
    const { events } = await run(["target"], 1);
    expect(events).toEqual([":broken failed", ":target skipped", ":after skipped"]);
    cleanup();
  });
});

describe("success-only finalizers", () => {
  test("a post-build finalizer runs after success and is skipped after a failure", async () => {
    const { root, run, cleanup } = setup();
    const post = root.tasks.register("post", Note, t => { t.finalizeOnSuccessOnly = true; });
    root.tasks.register("good", Note, t => t.finalizedBy(post));
    root.tasks.register("bad", Fail, t => t.finalizedBy(post));
    expect((await run(["good"], 1)).events).toEqual([":good executed", ":post executed"]);
    cleanup();

    const second = setup();
    const post2 = second.root.tasks.register("post", Note, t => { t.finalizeOnSuccessOnly = true; });
    second.root.tasks.register("bad", Fail, t => t.finalizedBy(post2));
    expect((await second.run(["bad"], 1)).events).toEqual([":bad failed", ":post skipped"]);
    second.cleanup();
  });
});

describe("variant resolution", () => {
  const linkage = attribute<string>("shard.linkage");
  const standard = attribute<string>("shard.c.standard");
  const RANK = ["c89", "c99", "c11", "c17", "c23"];

  /** Builds a .a for one module; its output is what the variant publishes. */
  class Archive extends Task {
    readonly file = this.outputFile("file");
    run() { writeFileSync(this.file.get(), this.path); }
  }

  /** Consumes resolved artifacts; records their values. */
  class LinkInputs extends Task {
    readonly libs = this.inputList<string>("libs");
    readonly out = this.outputFile("out");
    run() { writeFileSync(this.out.get(), this.libs.get().join(" ")); }
  }

  function cBuild() {
    const env = setup();
    const { build, dir } = env;
    // Consumers that do not ask for a linkage get static; standards are backwards compatible.
    build.schema.define(linkage, { disambiguate: (requested, offered) => requested ? [requested] : offered.filter(v => v === "static") });
    build.schema.define(standard, { compatible: (requested, produced) => RANK.indexOf(produced) <= RANK.indexOf(requested) });

    const library = (name: string, opts: { shared?: boolean; support?: string; api?: string[] } = {}) => {
      const p = build.addModule({ name, path: `:${name}`, dir: join(dir, name), buildDir: join(dir, name) });
      const api = p.configurations.scope("api");
      for (const dep of opts.api ?? []) api.add(moduleDependency(dep));
      const archive = p.tasks.register("archive", Archive, t => t.file.set(join(dir, `${name}.a`)));
      const linkStatic = p.configurations.consumable("linkStatic").attribute(linkage, "static").extendsFrom(api);
      linkStatic.artifacts.add(archive.flatMap(t => t.file).map(value => ({ type: "static-lib", value })));
      if (opts.support) linkStatic.attribute(standard, opts.support);
      if (opts.shared) {
        p.configurations.consumable("linkShared").attribute(linkage, "shared").extendsFrom(api)
          .artifacts.add({ type: "shared-lib", value: `${name}.so` });
      }
      return p;
    };

    const consumer = (deps: Dependency[], requestedStandard = "c17") => {
      const classpath = env.root.configurations.resolvable("linkClasspath").attribute(standard, requestedStandard);
      for (const dep of deps) classpath.add(dep);
      env.root.tasks.register("link", LinkInputs, t => {
        t.libs.addAll(classpath.incoming.artifacts().map(a => a.map(x => x.value)));
        t.out.set(join(dir, "link.txt"));
      });
      return classpath;
    };
    return { ...env, library, consumer };
  }

  test("transitive api dependencies come after their consumers, once", async () => {
    const { library, consumer, build, run, dir, cleanup } = cBuild();
    library("leaf");
    library("mid-a", { api: [":leaf"] });
    library("mid-b", { api: [":leaf"] });
    const classpath = consumer([moduleDependency(":mid-a"), moduleDependency(":mid-b")]);

    expect(classpath.incoming.nodes().map(n => n.owner)).toEqual([":mid-a", ":mid-b", ":leaf"]);
    expect(build.graph(["link"]).describe()).toEqual([":leaf:archive", ":mid-a:archive", ":mid-b:archive", ":link ← :mid-a:archive, :mid-b:archive, :leaf:archive"]);
    await run(["link"]);
    expect(readFileSync(join(dir, "link.txt"), "utf-8")).toBe([join(dir, "mid-a.a"), join(dir, "mid-b.a"), join(dir, "leaf.a")].join(" "));
    cleanup();
  });

  test("an edge attribute picks the variant, a disambiguation rule the default", () => {
    const { library, consumer, cleanup } = cBuild();
    library("greet", { shared: true });
    library("math", { shared: true });
    const classpath = consumer([
      moduleDependency(":greet", AttributeContainer.empty().with(linkage, "shared")),
      moduleDependency(":math"),
    ]);
    expect(classpath.incoming.nodes().map(n => `${n.owner} ${n.variant.name}`)).toEqual([":greet linkShared", ":math linkStatic"]);
    cleanup();
  });

  test("a unify rule gives every edge to a module the same value", () => {
    const schema = new AttributeSchema();
    schema.define(linkage, { unify: values => (values.includes("shared") ? "shared" : "static") });
    const edge = (v: string) => AttributeContainer.empty().with(linkage, v);
    expect(schema.unifyRequest(edge("static"), [edge("static"), edge("shared")]).get(linkage)).toBe("shared");
    expect(schema.unifyRequest(AttributeContainer.empty(), [edge("static")]).get(linkage)).toBe("static");
    expect(schema.unifyRequest(AttributeContainer.empty(), []).get(linkage)).toBeUndefined();
  });

  test("plugin-published variants resolve like modules", () => {
    const { consumer, cleanup } = cBuild();
    const m: Dependency = {
      kind: "variants", name: "sys:m", attributes: AttributeContainer.empty(),
      variants: [{ name: "system", attributes: AttributeContainer.empty(), artifacts: provider([{ type: "link-flag", value: "-lm" }]), dependencies: [] }],
    };
    const classpath = consumer([m]);
    expect(classpath.incoming.artifacts("link-flag").get()).toEqual([{ type: "link-flag", value: "-lm" }]);
    cleanup();
  });

  test("an incompatible standard names the request and what is offered", () => {
    const { library, consumer, cleanup } = cBuild();
    library("lib-std", { support: "c99" });
    const classpath = consumer([moduleDependency(":lib-std")], "c89");
    let error: ShardError | null = null;
    try { classpath.incoming.nodes(); } catch (e) { error = e as ShardError; }
    expect(error?.message).toBe("No variant of :lib-std matches what :linkClasspath requests");
    expect(error?.details).toEqual([["requested", "shard.c.standard=c89"], ["linkStatic", "shard.linkage=static, shard.c.standard=c99"]]);
    cleanup();
  });

  test("dependency cycles are reported; resolved configurations are final", () => {
    const { library, consumer, cleanup } = cBuild();
    library("a", { api: [":b"] });
    library("b", { api: [":a"] });
    const classpath = consumer([moduleDependency(":a")]);
    expect(() => classpath.incoming.nodes()).toThrow("Dependency cycle");

    const { library: lib2, consumer: consumer2, cleanup: cleanup2 } = cBuild();
    lib2("x");
    const resolved = consumer2([moduleDependency(":x")]);
    resolved.incoming.nodes();
    expect(() => resolved.add(moduleDependency(":y"))).toThrow("already resolved");
    cleanup();
    cleanup2();
  });
});

describe("initialization", () => {
  async function init(files: Record<string, string>, root = "app") {
    const dir = mkdtempSync(join(tmpdir(), "shard-init-"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    const build = new Build(join(dir, root));
    try {
      await initialize(build, { registry: builtinPlugins(), readers: [scriptReader], defaultPlugins: DEFAULT_PLUGINS, defines: ["GREET"] });
      return { build, error: null as ShardError | null };
    } catch (e) {
      return { build, error: e as ShardError };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a module reached twice is loaded once", async () => {
    const { build, error } = await init({
      "app/shard.ts": `export default ({ local }) => ({ dependencies: [local("../a"), local("../b")] });`,
      "a/shard.ts": `export default ({ local }) => ({ dependencies: [local("../leaf")] });`,
      "b/shard.ts": `export default ({ local }) => ({ dependencies: [local("../leaf", { linkage: "shared" })] });`,
      "leaf/shard.ts": `export default {};`,
    });
    expect(error).toBeNull();
    expect(build.allModules().map(m => m.path)).toEqual([":", ":a", ":leaf", ":b"]);
  });

  test("config functions see --def values", async () => {
    const { build, error } = await init({
      "app/shard.ts": `export default ({ defined }) => ({ c: { variant: defined("GREET") ? "greet" : "none" } });`,
    });
    expect(error).toBeNull();
    expect(build.root.extensions.get(C).variant.get()).toBe("greet");
  });

  test("unknown blocks, plugins and sources are config errors", async () => {
    expect((await init({ "app/shard.ts": `export default { cpp: {} };` })).error?.message).toContain('Unknown block "cpp"');
    expect((await init({ "app/shard.ts": `export default { plugins: ["rust"] };` })).error?.message).toBe('Unknown plugin "rust"');
    expect((await init({ "app/shard.ts": `export default { dependencies: [{ source: "svn" }] };` })).error?.message)
      .toBe('Unknown dependency source "svn"');
    expect((await init({ "app/shard.ts": `export default { c: { standard: "c++17" } };` })).error?.message)
      .toBe("Unknown standard 'c++17'");
  });
});
