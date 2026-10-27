import { dirname, join } from "path";
import { LinkType } from "../lang/types";
import { ShardError } from "../core/errors";
import { relativeTo } from "../core/fs";
import type { Toolchain } from "../toolchain/toolchain";
import { cacheEnabled } from "../cache/cache";
import { privateIncludes } from "../target/content";
import type { TargetGraph } from "../target/graph";
import { propagateUp } from "../target/propagate";
import { PackageShape } from "../target/shape";
import type { PreparedTarget } from "../target/target";
import {
  executablePath,
  libraryArtifacts,
  sharedLibPath,
  staticLibPath,
  type LibraryArtifacts,
} from "../workspace/artifacts";
import type { Layout } from "../workspace/layout";
import type { Workspace } from "../workspace/workspace";
import type { CompileUnit, LinkStep, PlannedTarget, TargetBuild } from "./plan";
import { mergeUsage, type Usage } from "./usage";

type PlanPart = Pick<PlannedTarget, "layout" | "usage" | "build">;

/** Turns prepared targets into toolchain invocations; usage requirements flow up the tree. */
export function planBuild(graph: TargetGraph<PreparedTarget>, ws: Workspace): TargetGraph<PlannedTarget> {
  const parts = propagateUp<PreparedTarget, PlanPart>(graph, {
    compute: (target, children) =>
      planTarget(target, mergeUsage(children.map(c => c.usage)), graph.isRoot(target), ws),
  });
  return graph.map(target => ({ ...target, ...parts.get(target.path)! }));
}

function planTarget(target: PreparedTarget, inherited: Usage, isRoot: boolean, ws: Workspace): PlanPart {
  const tc = ws.toolchain;
  const layout = ws.layoutOf(target);
  const build: Mutable<TargetBuild> = {
    useCache: cacheEnabled(ws.settings.cache.mode, isRoot),
    compile: [],
    link: [],
    ship: null,
    requireDir: null,
    executable: null,
  };
  let artifacts: LibraryArtifacts = { lib: null, shared: null };
  const linkType = target.settings.link.type ?? LinkType.Static;

  if (target.shape === PackageShape.Prebuilt) {
    build.requireDir = layout.outDir;
    artifacts = libraryArtifacts(target.name, target.shape, target.content, linkType, layout, tc.naming);
  } else if (target.shape !== PackageShape.HeaderOnly) {
    const includeDirs = [...inherited.includeDirs, ...privateIncludes(target.path, target.manifest, target.content)];
    build.compile = compileUnits(target, layout, includeDirs, tc);

    const objects = build.compile.map(u => u.task.object);
    const libPaths = [...inherited.libFiles];
    const libFlags = [...inherited.libFlags, ...target.linkFlags];
    const { subsystem, extra } = target.settings.link;

    if (target.shape === PackageShape.Executable) {
      const output = executablePath(target.name, layout, tc.naming);
      build.link = [{
        dir: dirname(output),
        invocation: tc.linker.link({ kind: "executable", objects, output, libPaths, libFlags, subsystem, extra }),
      }];
      build.ship = { libs: inherited.sharedLibs, toDir: dirname(output) };
      build.executable = output;
    } else {
      const library = (type: LinkType): LinkStep => {
        if (type === LinkType.Static) {
          return {
            dir: layout.outDir,
            invocation: tc.linker.archive({ objects, output: staticLibPath(target.name, layout, tc.naming) }),
          };
        }
        const output = sharedLibPath(target.name, layout, tc.naming);
        if (!output) {
          return {
            dir: layout.outDir,
            error: new ShardError(
              "build",
              `Shared libraries not supported on platform "${tc.target.platform}"`,
              "request static linking or use a supported platform",
            ),
          };
        }
        return {
          dir: layout.outDir,
          invocation: tc.linker.link({ kind: "shared", objects, output, libPaths, libFlags, subsystem, extra }),
        };
      };

      // A root library is always produced in both flavours.
      build.link = isRoot
        ? [library(linkType), library(linkType === LinkType.Static ? LinkType.Shared : LinkType.Static)]
        : [library(linkType)];
      artifacts = libraryArtifacts(target.name, target.shape, target.content, linkType, layout, tc.naming);
    }
  }

  const usage: Usage = {
    includeDirs: target.content.exports.length > 0 ? [layout.includeDir, ...inherited.includeDirs] : inherited.includeDirs,
    libFiles: artifacts.lib ? [artifacts.lib, ...inherited.libFiles] : inherited.libFiles,
    libFlags: [...target.linkFlags, ...inherited.libFlags],
    sharedLibs: artifacts.shared
      ? [{ path: artifacts.shared, ifExists: target.shape !== PackageShape.Prebuilt }, ...inherited.sharedLibs]
      : inherited.sharedLibs,
  };
  return { layout, usage, build };
}

function compileUnits(target: PreparedTarget, layout: Layout, includePaths: string[], tc: Toolchain): CompileUnit[] {
  const options = { includePaths, ...target.settings.compile };
  return target.content.sources.map(source => {
    const rel = relativeTo(target.path, source.path).replace(/\.c$/, ".o");
    const task = { source: source.path, object: join(layout.objectDir, rel), options };
    return {
      task,
      invocation: tc.compiler.compile(task, target.path),
      cacheKey: `${layout.id}/${rel}`,
      label: `${target.name}/${rel}`,
    };
  });
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
