import { join } from "path";
import pkg from "../../../package.json" with { type: "json" };
import { ModuleStore } from "../../plugins/git/store";
import { selectToolchain } from "../../plugins/toolchains";
import { DIRS } from "../../utils/dirs";
import { createConsole } from "../console/session";
import { openBuild, toolchainFacts } from "../engine";

export async function updateCommand(path: string, flags: { gitProtocol?: string; verbose?: boolean } = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const toolchain = selectToolchain();
  ui.emit({ type: "run.start", command: "update", details: [`shard ${pkg.version}`, ...toolchainFacts(toolchain)] });

  const { build, root } = await openBuild(path, { reporter: ui, toolchain, gitProtocol: flags.gitProtocol });
  const removed = new ModuleStore(join(build.rootDir, DIRS.MODULES)).prune(build.allModules().map(m => m.dir));
  ui.emit({ type: "run.end", command: "update", subject: root.name, artifacts: [], removed });
}
