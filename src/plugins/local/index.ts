import { basename, resolve } from "path";
import type { DependencyNotation, NotationHandler } from "../../core";
import { ShardError } from "../../utils/errors";

export interface LocalOptions {
  readonly linkage?: "static" | "shared";
}

export interface LocalNotation extends DependencyNotation {
  readonly source: "local";
  readonly path: string;
}

export const localNotation: NotationHandler = {
  source: "local",

  helper(path: string, options: LocalOptions = {}): LocalNotation {
    if (typeof path !== "string" || path === "") throw new ShardError("config", "local() needs a path");
    return { source: "local", path, ...(options.linkage ? { attributes: { linkage: options.linkage } } : {}) };
  },

  describe(notation) {
    const { path } = notation as LocalNotation;
    return { name: basename(path.replace(/[/\\]+$/, "")) || "local", source: "local", spec: path, link: notation.attributes?.linkage ?? null };
  },

  resolve(notation, from) {
    return { kind: "module", dir: resolve(from.dir, (notation as LocalNotation).path), note: { action: "local" } };
  },
};
