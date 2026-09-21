import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { BuildOptions, CStandard, PathPatterns, StandardOptions } from "./types";
import { resolveConditionals, type ConditionalContext } from "./conditional";
import { parseStandardName } from "./standards";
import { parseProfile } from "./profiles";
import { ShardError } from "../utils/errors";

export type { ConditionalContext } from "./conditional";

export interface Manifest {
  name?: string;
  version?: string;
  target?: string;
  depend: string[];
  sources?: PathPatterns;
  imports?: PathPatterns;
  exports?: PathPatterns;
  scripts: Record<string, string>;
  options: BuildOptions;
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

function parseOptions(raw: unknown): BuildOptions {
  if (!isPlainObject(raw)) return {};
  return {
    ...(raw as BuildOptions),
    profile: raw.profile === undefined ? undefined : parseProfile(raw.profile),
    standard: parseStandard(raw.standard),
  };
}

function parseStandard(raw: unknown): StandardOptions | undefined {
  if (raw === undefined) return undefined;

  if (typeof raw === "string") {
    return { version: parseStandardName(raw) };
  }

  if (isPlainObject(raw)) {
    const version = raw.version === undefined ? undefined : parseVersion(raw.version);
    const support = raw.support === undefined ? undefined : parseSupport(raw.support);
    const pedantic = raw.pedantic;
    if (pedantic !== undefined && typeof pedantic !== "boolean" && pedantic !== "error") {
      throw new ShardError("config", 'options.standard.pedantic must be true, false, or "error"');
    }
    return { version, support, pedantic };
  }

  throw new ShardError("config", "options.standard must be a string or an object");
}

function parseVersion(raw: unknown): CStandard {
  if (typeof raw !== "string") {
    throw new ShardError("config", "options.standard.version must be a string");
  }
  return parseStandardName(raw);
}

function parseSupport(raw: unknown): CStandard {
  if (typeof raw !== "string") {
    throw new ShardError("config", "options.standard.support must be a standard name");
  }
  return parseStandardName(raw);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
