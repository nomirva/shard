import { basename, resolve as resolvePath } from "path";
import type { LinkType } from "../module/types";
import type { InstallEnvironment, InstallResult, LocalDependency } from "./types";

export function parseLocal(value: string, link: LinkType | null): LocalDependency {
  const name = basename(value.replace(/[/\\]+$/, "")) || "local";
  return { kind: "local", link, name, version: null, target: value };
}

export async function installLocal(
  dep: LocalDependency,
  env: InstallEnvironment,
): Promise<InstallResult> {
  return { kind: "module", path: resolvePath(env.rootPath, dep.target), name: dep.name };
}
