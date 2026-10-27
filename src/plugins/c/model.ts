import { dirname, join } from "path";
import type { Module, Provider } from "../../core";
import { lazy } from "../../core";
import { scanContent, type ModuleContent } from "./content/content";
import { Unit } from "./content/unit";
import { deriveShape, PackageShape } from "./content/shape";
import { tripleDir } from "./toolchain/target";
import type { Toolchain } from "./toolchain/toolchain";
import { moduleId, type Layout } from "./layout";
import { DIRS } from "../../utils/dirs";
import type { CExtension } from "./extension";

export interface CModel {
  readonly content: ModuleContent;
  readonly generatedIncludes: readonly string[];
  readonly shape: PackageShape;
  readonly layout: Layout;
}

export function optional<T>(p: Provider<T>): T | undefined {
  return p.isPresent() ? p.get() : undefined;
}

export function cModel(module: Module, ext: CExtension, toolchain: () => Toolchain): Provider<CModel> {
  return lazy(() => {
    const scanned = scanContent(module.dir, {
      sources: optional(ext.sources),
      imports: optional(ext.imports),
      exports: optional(ext.exports),
    }, DIRS.TARGET);
    const generated = ext.generated.get();
    const content: ModuleContent = {
      ...scanned,
      sources: [...scanned.sources, ...generated.filter(f => f.endsWith(".c")).map(f => new Unit(f))],
    };
    const generatedIncludes = [...new Set(generated.filter(f => f.endsWith(".h")).map(f => dirname(f)))];

    const kind = optional(ext.kind);
    const shape = kind === "executable" ? PackageShape.Executable
      : kind === "library" ? PackageShape.Library
      : deriveShape(content, module.name);

    let layout: Layout | null = null;
    return {
      content,
      generatedIncludes,
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
