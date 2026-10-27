import { existsSync, rmSync } from "fs";
import { basename, join } from "path";
import { ShardError } from "../utils/errors";
import type { Reporter } from "../report/reporter";
import type { ConditionalContext } from "../manifest/conditional";
import { loadManifest } from "../manifest/manifest";
import type { Toolchain } from "../toolchain/toolchain";
import { selectToolchain } from "../toolchain/registry";
import type { DeclaredTarget } from "../target/target";
import { HookRunner } from "./hooks";
import { DIRS, layoutOf, type Layout } from "./layout";
import type { WorkspaceSettings } from "./settings";

export interface WorkspaceOptions {
  settings: WorkspaceSettings;
  reporter: Reporter;
  /** Commands that compile or resolve need a toolchain; info/clean/run work without one. */
  toolchain: boolean;
}

/** Composition root of one run: the root path, settings, toolchain, layout and hooks. */
export class Workspace {
  readonly hooks = new HookRunner();
  readonly settings: WorkspaceSettings;
  readonly reporter: Reporter;
  private readonly tc: Toolchain | null;

  private constructor(readonly rootPath: string, options: WorkspaceOptions) {
    this.settings = options.settings;
    this.reporter = options.reporter;
    this.tc = options.toolchain ? selectToolchain() : null;
  }

  static open(rootPath: string, options: WorkspaceOptions): Workspace {
    return new Workspace(rootPath, options);
  }

  get toolchain(): Toolchain {
    if (!this.tc) throw new ShardError("toolchain", "This command runs without a toolchain");
    return this.tc;
  }

  get shardDir(): string {
    return join(this.rootPath, DIRS.SHARD);
  }

  get modulesDir(): string {
    return join(this.rootPath, DIRS.MODULES);
  }

  /** Without a toolchain `?compiler:` conditionals see "unknown" and no defines. */
  conditionalContext(): ConditionalContext {
    return this.tc
      ? { compiler: this.tc.name, platform: process.platform, arch: process.arch, defines: [...this.settings.resolve.defines] }
      : { compiler: "unknown", platform: process.platform, arch: process.arch, defines: [] };
  }

  declare(path: string, name: string): DeclaredTarget {
    return { path, name, manifest: loadManifest(path, this.conditionalContext()) };
  }

  declareRoot(): DeclaredTarget {
    return this.declare(this.rootPath, basename(this.rootPath));
  }

  layoutOf(target: DeclaredTarget): Layout {
    return layoutOf(target, this.toolchain.target, this.rootPath);
  }

  /** Removes build cache, installed modules and artifacts; returns the removed directories. */
  clean(): string[] {
    const removed: string[] = [];
    for (const dir of [this.shardDir, this.modulesDir, join(this.rootPath, DIRS.TARGET)]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
      }
    }
    return removed;
  }
}
