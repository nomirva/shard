import { join } from "path";
import { LinkType } from "../lang/types";
import type { ArtifactNaming } from "../toolchain/toolchain";
import { PackageShape } from "../target/shape";
import type { ModuleContent } from "../target/content";
import type { Layout } from "./layout";

/** The single place that names build outputs. */

export function staticLibPath(name: string, layout: Layout, naming: ArtifactNaming): string {
  return join(layout.outDir, `${name}${naming.staticLibExt}`);
}

export function sharedLibPath(name: string, layout: Layout, naming: ArtifactNaming): string | null {
  return naming.sharedLibExt ? join(layout.outDir, `${name}${naming.sharedLibExt}`) : null;
}

export function executablePath(name: string, layout: Layout, naming: ArtifactNaming): string {
  return join(layout.outDir, `${name}${naming.exeExt ?? ""}`);
}

export interface LibraryArtifacts {
  /** What dependents link against. */
  lib: string | null;
  /** Shared library to ship next to executables. */
  shared: string | null;
}

/** Artifacts a library-like module offers to dependents (built or found on disk). */
export function libraryArtifacts(
  name: string,
  shape: PackageShape,
  content: ModuleContent,
  link: LinkType,
  layout: Layout,
  naming: ArtifactNaming,
): LibraryArtifacts {
  if (shape === PackageShape.Prebuilt) {
    const ext = naming.sharedLibExt;
    return {
      lib: content.artifacts.find(u => u.isArtifact)?.path ?? null,
      shared: ext ? content.artifacts.find(u => u.ext === ext)?.path ?? null : null,
    };
  }
  return {
    lib: link === LinkType.Shared ? sharedLibPath(name, layout, naming) : staticLibPath(name, layout, naming),
    shared: sharedLibPath(name, layout, naming),
  };
}
