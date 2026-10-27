import { existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { ShardError } from "../utils/errors";
import type { ConfigContext, ConfigReader, ModuleConfig } from "./init";

export const SCRIPT_FILE = "shard.ts";

/**
 * `shard.ts`: its default export is the module config, or a function of the
 * config context returning it:
 *
 *   export default ({ defined, local }) => ({
 *     dependencies: defined("GREET") ? [local("../lib-greet", { linkage: "shared" })] : [],
 *     c: { standard: "c11" },
 *   });
 */
export const scriptReader: ConfigReader = {
  file: SCRIPT_FILE,

  async read(dir: string, ctx: ConfigContext): Promise<ModuleConfig | null> {
    const file = join(dir, SCRIPT_FILE);
    if (!existsSync(file)) return null;

    let exported: unknown;
    try {
      exported = (await import(pathToFileURL(file).href)).default;
    } catch (e) {
      throw new ShardError("config", `Failed to load ${file}`, undefined, { output: (e as Error).message });
    }
    const config = typeof exported === "function" ? await exported(ctx) : exported;
    if (config === undefined) return {};
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new ShardError("config", `${file} must export a config object or a function returning one`);
    }
    return config as ModuleConfig;
  },
};
