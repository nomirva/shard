import type { Plugin } from "../../core";
import { clangProvider } from "./provider";
import { ShardError } from "../../utils/errors";
import { C_TOOLCHAIN } from "../c";

export function clangPlugin(): Plugin {
  return {
    id: "clang",
    apply(module) {
      module.services.provideLazily(C_TOOLCHAIN, () => {
        const toolchain = clangProvider.detect();
        if (!toolchain) {
          throw new ShardError("toolchain", "No supported toolchain found — install Clang", clangProvider.installHint);
        }
        return toolchain;
      });
    },
  };
}
