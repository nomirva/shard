import { LinkType } from "../../lang/types";
import type { TargetPlatform } from "../target";
import type { LinkFlags, LinkInput, LinkInputTranslator } from "../toolchain";

export function clangLinkInputs(target: TargetPlatform): LinkInputTranslator {
  return {
    translate(input: LinkInput): LinkFlags {
      if (input.kind === "library") {
        if (input.link === LinkType.Static) {
          if (target.platform !== "darwin") {
            return { flags: ["-Wl,-Bstatic", `-l${input.name}`, "-Wl,-Bdynamic"], warnings: [] };
          }
          return {
            flags: [`-l${input.name}`],
            warnings: [`"${input.name}" — -Bstatic unavailable on macOS, linking dynamically`],
          };
        }
        return { flags: [`-l${input.name}`], warnings: [] };
      }

      const warnings = input.link === LinkType.Static
        ? [`"${input.name}" — framework cannot be linked statically, linking dynamically`]
        : [];
      return { flags: [`-Wl,-framework,${input.name}`], warnings };
    },
  };
}
