export enum PackageShape {
  Executable = "executable",
  Library = "library",
  Prebuilt = "prebuilt",
  HeaderOnly = "header-only",
}

export enum LinkType {
  Static = "static",
  Shared = "shared",
}

export interface PackageJson {
  name?: string;
  version?: string;
  depend?: string[];
  options?: Record<string, unknown>;
  sources?: string[] | Record<string, string[]>;
  imports?: string[] | Record<string, string[]>;
  exports?: string[] | Record<string, string[]>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}
