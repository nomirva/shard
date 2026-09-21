import { LinkType } from "../module/types";
import { ShardError } from "../utils/errors";
import type { Dependency, InstallEnvironment, InstallResult } from "./types";
import { installGit, parseGit } from "./git";
import { installLocal, parseLocal } from "./local";
import { installLink, parseLink } from "./link";

export function parseDependency(triplet: string): Dependency {
  const { value, link } = splitLink(triplet);
  const colon = value.indexOf(":");
  if (colon === -1) {
    throw new ShardError(
      "config",
      `Invalid dependency format: "${triplet}"`,
      "expected one of: git:user/repo[@ref], local:../path, sys:z, framework:Cocoa",
    );
  }

  const prefix = value.slice(0, colon);
  const rest = value.slice(colon + 1);

  switch (prefix) {
    case "git": return parseGit(rest, link);
    case "local": return parseLocal(rest, link);
    case "sys": return parseLink("sys", rest, link);
    case "framework": return parseLink("framework", rest, link);
    default:
      throw new ShardError(
        "config",
        `Unknown dependency prefix "${prefix}"`,
        "supported prefixes: git, local, sys, framework",
      );
  }
}

export function parseDependencies(depend: readonly string[]): Dependency[] {
  return depend.map(parseDependency);
}

export function installDependency(
  dep: Dependency,
  env: InstallEnvironment,
): Promise<InstallResult> {
  switch (dep.kind) {
    case "git": return installGit(dep, env);
    case "local": return installLocal(dep, env);
    case "sys":
    case "framework": return installLink(dep);
  }
}

export function describeDependency(dep: Dependency): string {
  return `${dep.name} ${dep.link ?? "default (static)"}`;
}

function splitLink(triplet: string): { value: string; link: LinkType | null } {
  if (triplet.endsWith("+static")) return { value: triplet.slice(0, -7), link: LinkType.Static };
  if (triplet.endsWith("+shared")) return { value: triplet.slice(0, -7), link: LinkType.Shared };
  if (triplet.endsWith("+dynamic")) return { value: triplet.slice(0, -8), link: LinkType.Shared };
  return { value: triplet, link: null };
}
