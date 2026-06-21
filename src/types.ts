import type { UserBuildOptions } from "./toolchain/types";

export enum LinkType {
  Static = "static",
  Shared = "shared",
}

export enum PackageShape {
  Executable = "executable",
  Library = "library",
  Prebuilt = "prebuilt",
}

export interface PackageJson {
  depend?: string[];
  options?: UserBuildOptions;
  sources?: string[];
  includes?: string[];
}

export enum BuildResultType {
  Executable = "executable",
  StaticLib = "static-lib",
  SharedLib = "shared-lib",
}

export interface BuildResult {
  type: BuildResultType;
  includePaths: string[];
  libPaths: string[];
  executablePath: string | null;
  linkType: LinkType | null;
  sharedLibs: string[];
  sysLibs: string[];
}
