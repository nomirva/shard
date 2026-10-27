import { LinkType } from "../lang/types";
import { ShardError } from "../utils/errors";
import type { Dependency } from "./source";
import { knownExamples, knownPrefixes, sourceFor } from "./registry";

export function parseDependency(triplet: string): Dependency {
  const { value, link } = splitLink(triplet);
  const colon = value.indexOf(":");
  if (colon === -1) {
    throw new ShardError(
      "config",
      `Invalid dependency format: "${triplet}"`,
      `expected one of: ${knownExamples().join(", ")}`,
    );
  }

  const prefix = value.slice(0, colon);
  const source = sourceFor(prefix);
  if (!source) {
    throw new ShardError(
      "config",
      `Unknown dependency prefix "${prefix}"`,
      `supported prefixes: ${knownPrefixes().join(", ")}`,
    );
  }
  return source.parse(prefix, value.slice(colon + 1), link);
}

export function parseDependencies(depend: readonly string[]): Dependency[] {
  return depend.map(parseDependency);
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
