import { existsSync } from "fs";
import { join } from "path";
import type { ConfigContext, ConfigReader, DependencyNotation, ModuleConfig } from "../../core";
import { parseDependency } from "../../dependency/parse";
import { buildManifest, readManifest, type Manifest } from "../../manifest/manifest";
import { ShardError } from "../../utils/errors";

export const JSON_FILE = "shard.json";

type Helper = (value: string, options?: { linkage?: "static" | "shared" }) => DependencyNotation;

/**
 * `shard.json`: the same config as `shard.ts`, written as data. Conditional
 * keys (`?platform:darwin`, `?define:X`, `?compiler:clang`, `?arch:arm64`)
 * are resolved first; `depend` strings ("local:../lib+shared") become
 * dependency notations; `options` become the c block.
 */
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

/** "git:host/user/repo@v1+shared" → git("host/user/repo@v1", { linkage: "shared" }). */
function notation(spec: string, ctx: ConfigContext, file: string): DependencyNotation {
  try {
    parseDependency(spec);
  } catch (err) {
    if (err instanceof ShardError) err.details.push(["declared in", file]);
    throw err;
  }
  const link = /\+(static|shared|dynamic)$/.exec(spec);
  const linkage = link ? (link[1] === "static" ? "static" : "shared") : undefined;
  const value = link ? spec.slice(0, -link[0].length) : spec;
  const colon = value.indexOf(":");
  const prefix = value.slice(0, colon);
  const helper = ctx[prefix === "sys" ? "sys" : prefix] as Helper | undefined;
  if (!helper) throw new ShardError("config", `Unknown dependency prefix "${prefix}"`, undefined, { details: [["declared in", file]] });
  return helper(value.slice(colon + 1), linkage ? { linkage } : {});
}
