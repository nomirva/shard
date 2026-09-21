import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import chalk from "chalk";
import { LinkType, PackageShape, type CStandard, type Profile, type StandardOptions } from "../module/types";
import type { CompileOptions, CompileTask, Toolchain } from "../toolchain/toolchain";
import type { Module } from "../module/module";
import { privateIncludes, type ModuleContent } from "../module/content";
import type { ModuleGraph } from "../module/graph";
import { relativeTo } from "../utils/paths";
import { DIRS } from "../utils/constants";
import { runHook } from "../utils/scripts";
import { ShardError } from "../utils/errors";
import { Cache } from "./cache";
import { Layout } from "./layout";
import { artifactPath, sharedArtifactPath } from "./artifacts";
import { copyExports } from "./exports";

export interface BuildOptions {
  ignoreCache: number;
  extraDefines: string[];
  profile?: Profile;
}

interface BuildOutput {
  includeDirs: string[];
  libFiles: string[];
  libFlags: string[];
  sharedLibs: string[];
}

export class Builder {
  private readonly cache: Cache;

  constructor(
    private readonly toolchain: Toolchain,
    private readonly rootPath: string,
    private readonly options: BuildOptions,
  ) {
    this.cache = new Cache(join(rootPath, DIRS.SHARD));
  }

  async build(graph: ModuleGraph, standards: Map<Module, CStandard | undefined>): Promise<void> {
    const outputs = new Map<Module, BuildOutput>();
    try {
      for (const module of graph.topoOrder()) {
        const layout = new Layout(module, this.toolchain.currentTarget, this.rootPath);
        const info = mergeOutputs(
          graph.children(module)
            .map(child => outputs.get(child))
            .filter((o): o is BuildOutput => o !== undefined),
        );
        outputs.set(module, await this.buildModule(module, layout, info, graph, standards));
      }
    } finally {
      this.cache.save();
    }
  }

  private async buildModule(
    module: Module,
    layout: Layout,
    info: BuildOutput,
    graph: ModuleGraph,
    standards: Map<Module, CStandard | undefined>,
  ): Promise<BuildOutput> {
    const content = contentOf(module);
    runHook(module.path, module.manifest.scripts, "prebuild");

    let artifacts: { lib: string | null; shared: string | null } = { lib: null, shared: null };
    const link = graph.linkOf(module);

    if (module.shape === PackageShape.Prebuilt) {
      validatePrebuilt(module, layout);
      artifacts = {
        lib: artifactPath(module, layout, this.toolchain, link),
        shared: sharedArtifactPath(module, layout, this.toolchain),
      };
    } else if (module.shape !== PackageShape.HeaderOnly) {
      const includeDirs = [
        ...info.includeDirs,
        ...privateIncludes(module.path, module.manifest, content),
      ];
      const objects = await this.compileModule(module, layout, includeDirs, standards);
      artifacts = this.linkModule(module, layout, objects, info, graph);
    }

    copyExports(module, layout);
    runHook(module.path, module.manifest.scripts, "postbuild");

    const publicDir = content.exports.length > 0 ? layout.includeDir : null;
    const ownFlags = graph.flagsOf(module);
    return {
      includeDirs: publicDir ? [publicDir, ...info.includeDirs] : info.includeDirs,
      libFiles: artifacts.lib ? [artifacts.lib, ...info.libFiles] : info.libFiles,
      libFlags: [...ownFlags, ...info.libFlags],
      sharedLibs: artifacts.shared ? [artifacts.shared, ...info.sharedLibs] : info.sharedLibs,
    };
  }

  private async compileModule(
    module: Module,
    layout: Layout,
    includeDirs: string[],
    standards: Map<Module, CStandard | undefined>,
  ): Promise<string[]> {
    const useCache = this.options.ignoreCache === 0
      || (this.options.ignoreCache === 1 && module.path !== this.rootPath);
    const options = this.compileOptions(module, includeDirs, standards);
    const objects: string[] = [];

    for (const source of contentOf(module).sources) {
      const rel = relativeTo(module.path, source.path).replace(/\.c$/, ".o");
      const object = join(layout.objectDir, rel);
      const task: CompileTask = { source, object, relPath: rel, options };

      if (useCache && this.cache.isFresh(layout.id, task, this.toolchain)) {
        process.stderr.write(` ${chalk.dim("≡")} ${module.name}/${rel}\n`);
        objects.push(object);
        continue;
      }

      mkdirSync(dirname(object), { recursive: true });
      try {
        await this.toolchain.compile(task, module.path);
        process.stderr.write(` ${chalk.green("✔")} ${module.name}/${rel}\n`);
      } catch (err) {
        process.stderr.write(` ${chalk.red("✘")} ${module.name}/${rel}\n`);
        throw err;
      }
      if (useCache) this.cache.record(layout.id, task, this.toolchain);
      objects.push(object);
    }
    return objects;
  }

  private linkModule(
    module: Module,
    layout: Layout,
    objects: string[],
    info: BuildOutput,
    graph: ModuleGraph,
  ): { lib: string | null; shared: string | null } {
    const options = module.manifest.options;
    const libFlags = [...info.libFlags, ...graph.flagsOf(module)];
    const libPaths = info.libFiles;

    if (module.shape === PackageShape.Executable) {
      const output = join(layout.outDir, `${module.name}${this.toolchain.exeExt ?? ""}`);
      mkdirSync(dirname(output), { recursive: true });
      this.toolchain.link({
        kind: "executable",
        objects,
        output,
        options: { libPaths, libFlags, subsystem: options.subsystem, extra: options.linkExtra },
      });
      for (const shared of info.sharedLibs) {
        copyFileSync(shared, join(dirname(output), shared.split("/").pop()!));
      }
      return { lib: null, shared: null };
    }

    const link = graph.linkOf(module) ?? LinkType.Static;
    this.buildLibrary(module, layout, objects, link, libFlags, libPaths);
    if (module.path === this.rootPath) {
      const other = link === LinkType.Static ? LinkType.Shared : LinkType.Static;
      this.buildLibrary(module, layout, objects, other, libFlags, libPaths);
    }

    const lib = artifactPath(module, layout, this.toolchain, link);
    const shared = sharedArtifactPath(module, layout, this.toolchain);
    return { lib, shared: shared && existsSync(shared) ? shared : null };
  }

  private buildLibrary(
    module: Module,
    layout: Layout,
    objects: string[],
    linkType: LinkType,
    libFlags: string[],
    libPaths: string[],
  ): void {
    const options = module.manifest.options;
    mkdirSync(layout.outDir, { recursive: true });

    if (linkType === LinkType.Static) {
      this.toolchain.archive({ objects, output: join(layout.outDir, `${module.name}.a`) });
      return;
    }

    const ext = this.toolchain.sharedLibExt;
    if (!ext) {
      throw new ShardError(
        "build",
        `Shared libraries not supported on platform "${this.toolchain.currentTarget.platform}"`,
        "request static linking or use a supported platform",
      );
    }
    this.toolchain.link({
      kind: "shared",
      objects,
      output: join(layout.outDir, `${module.name}${ext}`),
      options: { libPaths, libFlags, subsystem: options.subsystem, extra: options.linkExtra },
    });
  }

  private compileOptions(
    module: Module,
    includePaths: string[],
    standards: Map<Module, CStandard | undefined>,
  ): CompileOptions {
    const o = module.manifest.options;
    const version = standards.get(module) ?? o.standard?.version;
    const standard: StandardOptions | undefined =
      version !== undefined || o.standard?.pedantic !== undefined
        ? { version, pedantic: o.standard?.pedantic, support: o.standard?.support }
        : undefined;

    return {
      includePaths,
      profile: this.options.profile ?? o.profile,
      standard,
      warnings: o.warnings,
      defines: [...(o.defines ?? []), ...this.options.extraDefines],
      extra: o.compileExtra,
    };
  }
}

export function executablePath(root: Module, rootPath: string, tc: Toolchain): string | null {
  if (root.shape !== PackageShape.Executable) return null;
  const layout = new Layout(root, tc.currentTarget, rootPath);
  return join(layout.outDir, `${root.name}${tc.exeExt ?? ""}`);
}

function contentOf(module: Module): ModuleContent {
  if (!module.content) {
    throw new ShardError("build", `Module "${module.name}" was not materialized`);
  }
  return module.content;
}

function validatePrebuilt(module: Module, layout: Layout): void {
  if (!existsSync(layout.outDir)) {
    throw new ShardError(
      "build",
      `Invalid prebuilt package "${module.name}": expected libraries at "${layout.outDir}"`,
      "check the module layout or exports field",
    );
  }
}

function mergeOutputs(outputs: BuildOutput[]): BuildOutput {
  const merged: BuildOutput = { includeDirs: [], libFiles: [], libFlags: [], sharedLibs: [] };
  for (const output of outputs) {
    pushUnique(merged.includeDirs, output.includeDirs);
    pushUnique(merged.libFiles, output.libFiles);
    pushUnique(merged.sharedLibs, output.sharedLibs);
    merged.libFlags.push(...output.libFlags);
  }
  return merged;
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}
