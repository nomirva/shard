import { join } from "path";
import { LinkType, PackageShape } from "../module/types";
import type { Toolchain } from "../toolchain/toolchain";
import type { Module } from "../module/module";
import type { Layout } from "./layout";

export function artifactPath(
  module: Module,
  layout: Layout,
  tc: Toolchain,
  link: LinkType | null,
): string | null {
  if (module.shape === PackageShape.Prebuilt || module.shape === PackageShape.HeaderOnly) {
    const artifact = module.content?.artifacts.find(u => u.isArtifact);
    return artifact ? artifact.path : null;
  }
  if (link === LinkType.Shared) return sharedArtifactPath(module, layout, tc);
  return join(layout.outDir, `${module.name}.a`);
}

export function sharedArtifactPath(module: Module, layout: Layout, tc: Toolchain): string | null {
  const ext = tc.sharedLibExt;
  if (!ext || module.shape === PackageShape.HeaderOnly) return null;
  if (module.shape === PackageShape.Prebuilt) {
    const artifact = module.content?.artifacts.find(u => u.ext === ext);
    return artifact ? artifact.path : null;
  }
  return join(layout.outDir, `${module.name}${ext}`);
}
