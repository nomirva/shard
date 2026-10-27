import { existsSync } from "fs";
import { join } from "path";
import type { ConfigContext, ConfigReader, DependencyNotation, ModuleConfig } from "../../core";
import { buildManifest, readManifest, type Manifest } from "./manifest";
import { ShardError } from "../../utils/errors";

export const JSON_FILE = "shard.json";

type Helper = (value: string, options?: { linkage?: "static" | "shared" }) => DependencyNotation;

export const jsonReader: ConfigReader = {
  file: JSON_FILE,

  async read(dir: string, ctx: ConfigContext): Promise<ModuleConfig | null> {
    const file = join(dir, JSON_FILE);
    if (!existsSync(file)) return null;
    let raw: unknown;
    try {
      raw = readManifest(dir);
    } catch (e) {
      throw new ShardError("config", `Invalid JSON in ${file}`, undefined, { output: (e as Error).message });
    }
    const manifest = buildManifest(raw, {
      compiler: typeof ctx.compiler === "string" ? ctx.compiler : "unknown",
      platform: ctx.platform,
      arch: ctx.arch,
      defines: [...ctx.defines],
    });
    return toConfig(manifest, ctx, file);
  },
};

function toConfig(manifest: Manifest, ctx: ConfigContext, file: string): ModuleConfig {
  const { options } = manifest;
  const c: Record<string, unknown> = {
    sources: manifest.sources,
    imports: manifest.imports,
    exports: manifest.exports,
    profile: options.profile,
    standard: options.standard,
    warnings: options.warnings,
    defines: options.defines,
    compileExtra: options.compileExtra,
    linkExtra: options.linkExtra,
    subsystem: options.subsystem,
    variant: manifest.target,
  };
  const config: Record<string, unknown> = {
    dependencies: manifest.depend.map(spec => notation(spec, ctx, file)),
    c: Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)),
  };
  if (Object.keys(manifest.scripts).length > 0) config.scripts = manifest.scripts;
  return config;
}

const PREFIXES: Record<string, { helper: string; example: string }> = {
  git: { helper: "git", example: "git:user/repo[@ref]" },
  local: { helper: "local", example: "local:../path" },
  sys: { helper: "sys", example: "sys:z" },
  framework: { helper: "framework", example: "framework:Cocoa" },
};

export function parseDepend(spec: string): { prefix: string; value: string; linkage?: "static" | "shared" } {
  const link = /\+(static|shared|dynamic)$/.exec(spec);
  const linkage = link ? (link[1] === "static" ? "static" : "shared") : undefined;
  const rest = link ? spec.slice(0, -link[0].length) : spec;
  const colon = rest.indexOf(":");
  if (colon === -1) {
    throw new ShardError("config", `Invalid dependency format: "${spec}"`,
      `expected one of: ${Object.values(PREFIXES).map(p => p.example).join(", ")}`);
  }
  const prefix = rest.slice(0, colon);
  if (!PREFIXES[prefix]) {
    throw new ShardError("config", `Unknown dependency prefix "${prefix}"`, `supported prefixes: ${Object.keys(PREFIXES).join(", ")}`);
  }
  return { prefix, value: rest.slice(colon + 1), ...(linkage ? { linkage } : {}) };
}

function notation(spec: string, ctx: ConfigContext, file: string): DependencyNotation {
  let parsed;
  try {
    parsed = parseDepend(spec);
  } catch (err) {
    if (err instanceof ShardError) err.details.push(["declared in", file]);
    throw err;
  }
  const helper = ctx[PREFIXES[parsed.prefix]!.helper] as Helper;
  return helper(parsed.value, parsed.linkage ? { linkage: parsed.linkage } : {});
}
