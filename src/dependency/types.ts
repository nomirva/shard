import type { LinkType } from "../module/types";
import type { GitPin } from "./integrity";

export interface GitDependency {
  kind: "git";
  link: LinkType | null;
  name: string;
  version: string | null;
  repo: string;
  pin: GitPin;
  subdir?: string;
}

export interface LocalDependency {
  kind: "local";
  link: LinkType | null;
  name: string;
  version: string | null;
  target: string;
}

export interface LinkDependency {
  kind: "sys" | "framework";
  link: LinkType | null;
  name: string;
  version: string | null;
  value: string;
}

export type Dependency = GitDependency | LocalDependency | LinkDependency;

export type InstallResult =
  | { kind: "module"; path: string; name: string }
  | { kind: "flags"; flags: string[] };

export interface InstallEnvironment {
  rootPath: string;
  gitProtocol: string;
  onProgress?: (percent: number) => void;
}
