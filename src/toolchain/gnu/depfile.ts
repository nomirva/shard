import { readFileSync } from "fs";
import type { DependencyTracker } from "../toolchain";

/** Make-style `.d` files written next to the object (`-MMD -MF`), shared by clang and gcc. */
export const depfileTracker: DependencyTracker = {
  compileFlags(object: string): string[] {
    return ["-MMD", "-MF", depFilePath(object)];
  },

  dependencies(object: string): string[] {
    try {
      const raw = readFileSync(depFilePath(object), "utf-8");
      const joined = raw.replace(/\\\r?\n\s*/g, " ");
      const colon = joined.search(/:(?=\s|$)/);
      if (colon === -1) return [];
      return joined.slice(colon + 1).trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  },
};

function depFilePath(object: string): string {
  return object.replace(/\.\w+$/, ".d");
}
