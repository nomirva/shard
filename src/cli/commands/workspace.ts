import { resolve } from "path";
import type { Reporter } from "../../report/reporter";
import { Workspace } from "../../workspace/workspace";
import { createSettings, type SettingsInput } from "../../workspace/settings";
import type { Toolchain } from "../../toolchain/toolchain";
import { shortVersion } from "../console/format";

export function openWorkspace(
  path: string,
  reporter: Reporter,
  toolchain: boolean,
  settings: SettingsInput = {},
): Workspace {
  return Workspace.open(resolve(path), { settings: createSettings(settings), reporter, toolchain });
}

/** "clang 21.0.0", "arm64-darwin" — the header facts of a run. */
export function toolchainFacts(tc: Toolchain): string[] {
  const { arch, platform, abi } = tc.target;
  return [`${tc.name} ${shortVersion(tc.version)}`, `${arch}-${platform}${abi === "none" ? "" : `-${abi}`}`];
}
