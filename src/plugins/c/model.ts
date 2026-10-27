import { join } from "path";
import type { Module, Provider } from "../../core";
import { lazy } from "../../core";
import { scanContent, type ModuleContent } from "../../target/content";
import { deriveShape, PackageShape } from "../../target/shape";
import { tripleDir } from "../../toolchain/target";
import type { Toolchain } from "../../toolchain/toolchain";
import { DIRS, moduleId, type Layout } from "../../workspace/layout";
import type { CExtension } from "./extension";

/** What a module is, worked out once configuration is over. */
export interface CModel {
  readonly content: ModuleContent;
  readonly shape: PackageShape;
  readonly layout: Layout;
}

export function optional<T>(p: Provider<T>): T | undefined {
  return p.isPresent() ? p.get() : undefined;
}

/**
 * Scans the module's files on first use. Objects of every module live under
 * the root's `.shard/<id>`; outputs of dependencies under `.shard/<name>`.
 */
export function cModel(module: Module, ext: CExtension, toolchain: () => Toolchain): Provider<CModel> {
  return lazy(() => {
    const content = scanContent(module.dir, {
      sources: optional(ext.sources),
      imports: optional(ext.imports),
      exports: optional(ext.exports),
    }, DIRS.TARGET);

    const kind = optional(ext.kind);
    const shape = kind === "executable" ? PackageShape.Executable
      : kind === "library" ? PackageShape.Library
      : deriveShape(content, module.name);

    // The layout needs the toolchain's target; `shard info` reads content and shape without one.
    let layout: Layout | null = null;
    return {
      content,
      shape,
      get layout(): Layout {
        return (layout ??= layoutOf(module, optional(ext.variant), tripleDir(toolchain().target)));
      },
    };
  });
}

function layoutOf(module: Module, variant: string | undefined, triple: string): Layout {
  const isRoot = module.dir === module.rootDir;
  const id = moduleId(module.rootDir, module.dir);
  const moduleDir = isRoot ? module.dir : join(module.rootDir, DIRS.SHARD, module.name);
  const outDir = join(moduleDir, DIRS.TARGET, variant ? join(triple, variant) : triple);
  return {
    id,
    moduleDir,
    outDir,
    objectDir: join(module.rootDir, DIRS.SHARD, id),
    includeDir: join(outDir, DIRS.INCLUDE),
  };
}
