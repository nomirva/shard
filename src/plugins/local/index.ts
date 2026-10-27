import { resolve } from "path";
import type { DependencyNotation, NotationHandler } from "../../core";
import { ShardError } from "../../utils/errors";

export interface LocalOptions {
  /** "static" (default) or "shared". */
  readonly linkage?: "static" | "shared";
}

export interface LocalNotation extends DependencyNotation {
  readonly source: "local";
  readonly path: string;
}

/** `local("../lib", { linkage: "shared" })`: a module in another directory, relative to the declaring module. */
export const localNotation: NotationHandler = {
  source: "local",

  helper(path: string, options: LocalOptions = {}): LocalNotation {
    if (typeof path !== "string" || path === "") throw new ShardError("config", "local() needs a path");
    return { source: "local", path, ...(options.linkage ? { attributes: { linkage: options.linkage } } : {}) };
  },

  resolve(notation, from) {
    return { kind: "module", dir: resolve(from.dir, (notation as LocalNotation).path) };
  },
};
