import type { Plugin } from "../../core";
import { clangProvider } from "../../toolchain/clang";
import { ShardError } from "../../utils/errors";
import { C_TOOLCHAIN } from "../c";

/** Detects clang once per build and offers it as the C toolchain. */
export function clangPlugin(): Plugin {
  return {
    id: "clang",
    apply(module) {
      module.services.getOrRegister(C_TOOLCHAIN, () => {
        const toolchain = clangProvider.detect();
        if (!toolchain) {
          throw new ShardError("toolchain", "No supported toolchain found — install Clang", clangProvider.installHint);
        }
        return toolchain;
      });
    },
  };
}
