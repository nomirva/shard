import { ShardError } from "../../core/errors";
import type { Profile } from "../../lang/types";
import type { CacheMode } from "../../cache/cache";
import { buildPipeline } from "../../pipeline/pipelines";
import { start } from "../../pipeline/stages/start";
import { banner } from "../console/reporter";
import { openWorkspace } from "./workspace";

export interface BuildFlags {
  ignoreCache?: string;
  start?: boolean;
  def?: string[];
  gitProtocol?: string;
  profile?: Profile;
}

export async function buildCommand(path: string, flags: BuildFlags = {}): Promise<void> {
  console.log();
  const ws = openWorkspace(path, true, {
    cacheMode: parseCacheMode(flags.ignoreCache),
    defines: (flags.def ?? []).flatMap(d => d.split(",")).filter(Boolean),
    profile: flags.profile,
    gitProtocol: flags.gitProtocol,
  });

  const pipeline = flags.start ? buildPipeline.pipe(start) : buildPipeline;
  await pipeline.run(undefined, ws);

  banner("BUILD SUCCEEDED", true);
  console.log();
}

function parseCacheMode(raw: string | undefined): CacheMode {
  const mode = raw !== undefined ? parseInt(raw, 10) : 0;
  if (Number.isNaN(mode) || mode < 0 || mode > 2) {
    throw new ShardError("usage", "--ignore-cache must be 0, 1, or 2");
  }
  return mode as CacheMode;
}
