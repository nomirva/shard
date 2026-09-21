import type { Unit } from "../module/unit";
import type { WarningSet, Subsystem, Profile, StandardOptions } from "../module/types";

export type { WarningSet, Subsystem, Profile, StandardOptions } from "../module/types";

export interface TargetPlatform {
  platform: string;
  arch: string;
  abi: string;
}

export const HOST_TARGET: TargetPlatform = {
  platform: process.platform,
  arch: process.arch,
  abi: "none",
};

export interface CompileOptions {
  includePaths: string[];
  target?: TargetPlatform;
  profile?: Profile;
  standard?: StandardOptions;
  warnings?: WarningSet;
  defines?: string[];
  extra?: string[];
}

export interface LinkOptions {
  libPaths: string[];
  libFlags: string[];
  target?: TargetPlatform;
  subsystem?: Subsystem;
  extra?: string[];
}

export interface CompileTask {
  source: Unit;
  object: string;
  relPath: string;
  options: CompileOptions;
}

export interface LinkTask {
  kind: "executable" | "shared";
  objects: string[];
  output: string;
  options: LinkOptions;
}

export interface ArchiveTask {
  objects: string[];
  output: string;
}

export interface Toolchain {
  readonly name: string;
  version: string;
  currentTarget: TargetPlatform;

  detect(): boolean;

  compile(task: CompileTask, cwd?: string): Promise<void>;
  link(task: LinkTask): void;
  archive(task: ArchiveTask): void;

  dependencies(task: CompileTask): string[];

  get targetDir(): string;
  get exeExt(): string | null;
  get sharedLibExt(): string | null;
}
