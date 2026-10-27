import type { Manifest } from "../manifest/manifest";
import type { ModuleContent } from "./content";
import type { PackageShape } from "./shape";
import type { TargetSettings } from "./settings";

/*
 * One module of the dependency tree on its way through the pipeline.
 * Every stage returns the next phase instead of mutating the previous one,
 * so a field is present exactly when the type says so.
 */

/** discover / resolve: the manifest has been read. */
export interface DeclaredTarget {
  readonly path: string;
  readonly name: string;
  readonly manifest: Manifest;
}

/** resolve: dependencies are installed; system link inputs are translated by the toolchain. */
export interface ResolvedTarget extends DeclaredTarget {
  readonly linkFlags: readonly string[];
}

/** prepare: `preload` has run and the files on disk are scanned. */
export interface ScannedTarget extends ResolvedTarget {
  readonly content: ModuleContent;
}

/** prepare: shape and effective settings are fixed. */
export interface PreparedTarget extends ScannedTarget {
  readonly shape: PackageShape;
  readonly settings: TargetSettings;
}
