import { LinkType } from "../module/types";
import type { InstallResult, LinkDependency } from "./types";

export function parseLink(
  mode: "sys" | "framework",
  value: string,
  link: LinkType | null,
): LinkDependency {
  return { kind: mode, link, name: `${mode}:${value}`, version: null, value };
}

export async function installLink(dep: LinkDependency): Promise<InstallResult> {
  if (dep.kind === "sys") {
    const isMac = process.platform === "darwin";
    if (dep.link === LinkType.Static) {
      if (!isMac) return { kind: "flags", flags: ["-Wl,-Bstatic", `-l${dep.value}`, "-Wl,-Bdynamic"] };
      warn(`"${dep.value}" — -Bstatic unavailable on macOS, linking dynamically`);
    }
    return { kind: "flags", flags: [`-l${dep.value}`] };
  }

  if (dep.link === LinkType.Static) {
    warn(`"${dep.value}" — framework cannot be linked statically, linking dynamically`);
  }
  return { kind: "flags", flags: [`-Wl,-framework,${dep.value}`] };
}

function warn(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}
