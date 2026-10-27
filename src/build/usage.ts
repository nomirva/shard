import { pushUnique } from "../utils/object";

/** Usage requirements: what a dependency passes up to everything that depends on it. */
export interface Usage {
  readonly includeDirs: readonly string[];
  readonly libFiles: readonly string[];
  readonly libFlags: readonly string[];
  readonly sharedLibs: readonly SharedLib[];
}

export interface SharedLib {
  readonly path: string;
  /** Built libraries count only if the link step actually produced them. */
  readonly ifExists: boolean;
}

export const EMPTY_USAGE: Usage = { includeDirs: [], libFiles: [], libFlags: [], sharedLibs: [] };

export function mergeUsage(usages: readonly Usage[]): Usage {
  const includeDirs: string[] = [];
  const libFiles: string[] = [];
  const libFlags: string[] = [];
  const sharedLibs: SharedLib[] = [];
  for (const usage of usages) {
    pushUnique(includeDirs, usage.includeDirs);
    pushUnique(libFiles, usage.libFiles);
    pushUnique(sharedLibs, usage.sharedLibs, lib => lib.path);
    libFlags.push(...usage.libFlags);
  }
  return { includeDirs, libFiles, libFlags, sharedLibs };
}
