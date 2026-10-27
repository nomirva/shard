import type { Dependency, DependencySource } from "./source";
import { gitSource } from "./sources/git/source";
import { localSource } from "./sources/local";
import { systemSource } from "./sources/system";

const sources: DependencySource<any>[] = [];
const byPrefix = new Map<string, DependencySource<any>>();

export function registerSource<D extends Dependency>(source: DependencySource<D>): void {
  sources.push(source);
  for (const prefix of source.prefixes) byPrefix.set(prefix, source);
}

export function sourceFor(prefix: string): DependencySource<Dependency> | undefined {
  return byPrefix.get(prefix);
}

export function knownPrefixes(): string[] {
  return sources.flatMap(s => s.prefixes);
}

export function knownExamples(): string[] {
  return sources.flatMap(s => s.examples);
}

registerSource(gitSource);
registerSource(localSource);
registerSource(systemSource);
