import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { availableParallelism } from "os";
import { join, resolve } from "path";
import { Build, initialize, scriptReader, type ExecutionListener } from "../../core";
import { JsonCacheStore } from "../../cache/store";
import { builtinPlugins, DEFAULT_PLUGINS, jsonReader } from "../../plugins";
import { C_PARAMETERS, C_TOOLCHAIN, type CParameters } from "../../plugins/c";
import { selectToolchain } from "../../toolchain/registry";
import { GIT_PARAMETERS } from "../../plugins/git";
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
  // Known before configs are read, so `?compiler:` conditionals and `compiler` in shard.ts see it.
  const toolchain = build.services.register(C_TOOLCHAIN, selectToolchain());
  build.services.register(GIT_PARAMETERS, {
    protocol: flags.gitProtocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https",
  });
  build.onWarning((_module, message) => process.stderr.write(`⚠ ${message}\n`));
  const root = await initialize(build, {
    registry: builtinPlugins(),
    readers: [scriptReader, jsonReader],
    defaultPlugins: DEFAULT_PLUGINS,
    defines: params.defines,
    context: { compiler: toolchain.name },
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
