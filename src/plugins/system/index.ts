import { AttributeContainer, provider, type DependencyNotation, type NotationHandler } from "../../core";
import { LinkType } from "../c/lang/types";
import type { LinkInput } from "../c/toolchain/toolchain";
import { ShardError } from "../../utils/errors";
import { ARTIFACT, C_TOOLCHAIN } from "../c";

export interface SystemOptions {
  readonly linkage?: "static" | "shared";
}

interface SystemNotation extends DependencyNotation {
  readonly kind: LinkInput["kind"];
  readonly name: string;
  readonly linkage?: "static" | "shared";
}

/**
 * Libraries the system provides: nothing to build or fetch. The toolchain
 * turns them into link flags, published as a variant without a module.
 */
function systemNotation(source: "sys" | "framework", kind: LinkInput["kind"]): NotationHandler {
  return {
    source,

    helper(name: string, options: SystemOptions = {}): SystemNotation {
      if (typeof name !== "string" || name === "") throw new ShardError("config", `${source}() needs a library name`);
      return { source, kind, name, ...(options.linkage ? { linkage: options.linkage } : {}) };
    },

    describe(notation) {
      const { name, linkage } = notation as SystemNotation;
      return { name: `${source}:${name}`, source: source === "sys" ? "system" : source, spec: name, link: linkage ?? null };
    },

    resolve(notation, from) {
      const { name, linkage } = notation as SystemNotation;
      const toolchain = from.services.get(C_TOOLCHAIN, "apply a toolchain plugin, e.g. clang");
      const link = linkage === "static" ? LinkType.Static : linkage === "shared" ? LinkType.Shared : null;
      const { flags, warnings } = toolchain.linkInputs.translate({ kind, name, link });
      return {
        kind: "variants",
        name: `${source}:${name}`,
        variants: [{
          name: "system",
          attributes: AttributeContainer.empty(),
          artifacts: provider(flags.map(value => ({ type: ARTIFACT.LINK_FLAG, value }))),
          dependencies: [],
        }],
        note: { action: "linked", flags, warnings },
      };
    },
  };
}

/** `sys("m")`: -lm. */
export const sysNotation = systemNotation("sys", "library");

/** `framework("Cocoa")`: a macOS framework. */
export const frameworkNotation = systemNotation("framework", "framework");
