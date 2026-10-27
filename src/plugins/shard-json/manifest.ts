import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveConditionals, type ConditionalContext } from "./conditional";
import { parseOptions, type ManifestOptions } from "../c/options";

export type PathPatterns = string[] | Record<string, string[]>;

export interface Manifest {
  name?: string;
  version?: string;
  target?: string;
  depend: string[];
  sources?: PathPatterns;
  imports?: PathPatterns;
  exports?: PathPatterns;
  scripts: Record<string, string>;
  options: ManifestOptions;
}

export function readManifest(modulePath: string): unknown {
  const file = join(modulePath, "shard.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function buildManifest(raw: unknown, ctx: ConditionalContext): Manifest {
  const r = resolveConditionals(raw, ctx) as Record<string, unknown>;
  return {
    name: asString(r.name),
    version: asString(r.version),
    target: asString(r.target),
    depend: asStringArray(r.depend),
    sources: r.sources as PathPatterns | undefined,
    imports: r.imports as PathPatterns | undefined,
    exports: r.exports as PathPatterns | undefined,
    scripts: (r.scripts ?? {}) as Record<string, string>,
    options: parseOptions(r.options),
  };
}

export function loadManifest(modulePath: string, ctx: ConditionalContext): Manifest {
  return buildManifest(readManifest(modulePath), ctx);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
