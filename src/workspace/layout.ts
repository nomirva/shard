import { join, relative } from "path";
import { DIRS } from "../core/dirs";
import { tripleDir, type TargetPlatform } from "../toolchain/target";
import type { DeclaredTarget } from "../target/target";

/** Where one target's objects, outputs and public headers live. */
export interface Layout {
  readonly id: string;
  readonly moduleDir: string;
  readonly outDir: string;
  readonly objectDir: string;
  readonly includeDir: string;
}

export function layoutOf(target: DeclaredTarget, platform: TargetPlatform, rootPath: string): Layout {
  const id = moduleId(rootPath, target.path);
  const moduleDir = target.path === rootPath ? target.path : join(rootPath, DIRS.SHARD, target.name);
  const triple = tripleDir(platform);
  const variant = target.manifest.target;
  const outDir = join(moduleDir, DIRS.TARGET, variant ? join(triple, variant) : triple);
  return {
    id,
    moduleDir,
    outDir,
    objectDir: join(rootPath, DIRS.SHARD, id),
    includeDir: join(outDir, DIRS.INCLUDE),
  };
}

export function moduleId(rootPath: string, modulePath: string): string {
  if (modulePath === rootPath) return "_";
  return relative(rootPath, modulePath).replace(/[/\\]+/g, "__");
}
