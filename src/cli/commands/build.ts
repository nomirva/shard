import pkg from "../../../package.json" with { type: "json" };
import { ShardError } from "../../utils/errors";
import type { Profile } from "../../lang/types";
import type { CacheMode } from "../../cache/cache";
import type { PlannedTarget } from "../../build/plan";
import { buildPipeline } from "../../pipeline/pipelines";
import { start } from "../../pipeline/stages/start";
import { createConsole } from "../console/session";
import { openWorkspace, toolchainFacts } from "./workspace";

export interface BuildFlags {
  ignoreCache?: string;
  start?: boolean;
  def?: string[];
  gitProtocol?: string;
  profile?: Profile;
  verbose?: boolean;
}

export async function buildCommand(path: string, flags: BuildFlags = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const cacheMode = parseCacheMode(flags.ignoreCache);
  const ws = openWorkspace(path, ui, true, {
    cacheMode,
    defines: (flags.def ?? []).flatMap(d => d.split(",")).filter(Boolean),
    profile: flags.profile,
    gitProtocol: flags.gitProtocol,
  });

  const details = [`shard ${pkg.version}`, ...toolchainFacts(ws.toolchain)];
  if (flags.profile) details.push(`profile ${flags.profile}`);
  if (cacheMode !== 0) details.push(cacheMode === 1 ? "root cache off" : "cache off");
  ui.emit({ type: "run.start", command: "build", details });

  const graph = await buildPipeline.run(undefined, ws);
  ui.emit({ type: "run.end", command: "build", subject: graph.root.name, artifacts: rootArtifacts(graph.root) });

  if (flags.start) await start.run(graph, ws);
}

function rootArtifacts(root: PlannedTarget): string[] {
  if (root.build.executable) return [root.build.executable];
  return root.build.link.filter(step => !("error" in step)).map(step => step.output);
}

function parseCacheMode(raw: string | undefined): CacheMode {
  const mode = raw !== undefined ? parseInt(raw, 10) : 0;
  if (Number.isNaN(mode) || mode < 0 || mode > 2) {
    throw new ShardError("usage", "--ignore-cache must be 0, 1, or 2", undefined, {
      details: [["got", String(raw)]],
    });
  }
  return mode as CacheMode;
}
