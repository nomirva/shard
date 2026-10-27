import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { availableParallelism } from "os";
import { join, resolve } from "path";
import { Build, initialize, scriptReader, type ExecutionListener } from "../../core";
import { JsonCacheStore } from "../../cache/store";
import { builtinPlugins, DEFAULT_PLUGINS } from "../../plugins";
import { C_PARAMETERS, type CParameters } from "../../plugins/c";
import type { CLink } from "../../plugins/c/tasks";
import { DIRS } from "../../workspace/layout";
import { ShardError } from "../../utils/errors";
import type { BuildFlags } from "./build";

/**
 * `shard build` on the plugin core (SHARD_ENGINE=core): reads `shard.ts`,
 * runs `assemble` of the root module. Output is one line per finished task
 * until the console reporter moves over to task events.
 */
export async function coreBuildCommand(path: string, flags: BuildFlags, params: CParameters): Promise<void> {
  const rootDir = resolve(path);
  if (!existsSync(rootDir)) throw new ShardError("usage", `Module directory not found: ${rootDir}`);

  const build = new Build(rootDir);
  build.services.register(C_PARAMETERS, params);
  const root = await initialize(build, {
    registry: builtinPlugins(),
    readers: [scriptReader],
    defaultPlugins: DEFAULT_PLUGINS,
    defines: params.defines,
  });

  const listener: ExecutionListener = {
    taskEnd: (task, outcome) => {
      if (outcome.kind !== "skipped") process.stderr.write(`${outcome.kind.padEnd(10)} ${task.path}\n`);
    },
  };
  const { failures } = await build.run(["assemble"], {
    jobs: availableParallelism(),
    cache: new JsonCacheStore(join(rootDir, DIRS.SHARD, "core")),
    listener,
  });
  if (failures.length > 0) throw failures[0];

  if (flags.start) {
    const exe = (root.tasks.named("link").get() as CLink).file.get();
    const proc = spawnSync(exe, [], { stdio: "inherit" });
    process.exit(proc.status ?? 0);
  }
}
