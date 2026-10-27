import { join } from "path";
import pkg from "../../../package.json" with { type: "json" };
import { ModuleStore } from "../../dependency/store";
import { selectToolchain } from "../../toolchain/registry";
import { DIRS } from "../../workspace/layout";
import { createConsole } from "../console/session";
import { openBuild } from "../engine";
import { toolchainFacts } from "./workspace";

/** `shard update`: installs what the module tree declares and removes modules it no longer reaches. */
export async function updateCommand(path: string, flags: { gitProtocol?: string; verbose?: boolean } = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const toolchain = selectToolchain();
  ui.emit({ type: "run.start", command: "update", details: [`shard ${pkg.version}`, ...toolchainFacts(toolchain)] });

  const { build, root } = await openBuild(path, { reporter: ui, toolchain, gitProtocol: flags.gitProtocol });
  const removed = new ModuleStore(join(build.rootDir, DIRS.MODULES)).prune(build.allModules().map(m => m.dir));
  ui.emit({ type: "run.end", command: "update", subject: root.name, artifacts: [], removed });
}
