import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CacheStore } from "../src/cache/store";
import { Build, extension, Property, provider, Task, type ExecutionListener, type Plugin, type TaskContext } from "../src/core";

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
  const build = new Build();
  const root = build.addProject({ name: "app", path: ":", dir, buildDir: join(dir, ".shard") });
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
      apply: project => {
        const ext = project.extensions.add(Greeting, { text: new Property<string>(":greeting.text").convention("hi") });
        project.tasks.register("greet", WriteText, t => t.text.set(ext.text));
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
