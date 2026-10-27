import { spawnSync } from "child_process";
import { basename } from "path";
import pkg from "../../../package.json" with { type: "json" };
import { ShardError } from "../../utils/errors";
import type { Profile } from "../../plugins/c/lang/types";
import type { CacheMode } from "../../plugins/c/cache";
import { CArchive, CLink } from "../../plugins/c";
import { selectToolchain } from "../../plugins/toolchains";
import { createConsole } from "../console/session";
import { jobCount, openBuild, runTasks, toolchainFacts } from "../engine";

export interface BuildFlags {
  ignoreCache?: string;
  start?: boolean;
  def?: string[];
  gitProtocol?: string;
  profile?: Profile;
  verbose?: boolean;
  jobs?: string;
}

/** `shard build`: resolves the module tree, then runs `assemble` of the root module. */
export async function buildCommand(path: string, flags: BuildFlags = {}): Promise<void> {
  const ui = createConsole(flags.verbose);
  const cacheMode = parseCacheMode(flags.ignoreCache);
  const jobs = jobCount(flags.jobs);
  const defines = (flags.def ?? []).flatMap(d => d.split(",")).filter(Boolean);
  const toolchain = selectToolchain();

  const details = [`shard ${pkg.version}`, ...toolchainFacts(toolchain)];
  if (flags.profile) details.push(`profile ${flags.profile}`);
  if (cacheMode !== 0) details.push(cacheMode === 1 ? "root cache off" : "cache off");
  ui.emit({ type: "run.start", command: "build", details });

  const open = await openBuild(path, {
    reporter: ui,
    toolchain,
    params: { profile: flags.profile, defines, cacheMode },
    gitProtocol: flags.gitProtocol,
  });
  const graph = await runTasks(open, ["assemble"], { reporter: ui, jobs });

  const outputs = graph.tasks()
    .filter(t => t.modulePath === ":" && (t instanceof CArchive || t instanceof CLink))
    .map(t => t as CArchive | CLink);
  const executable = outputs.find(t => t instanceof CLink && t.kind.get() === "executable")?.file.get();
  const artifacts = executable ? [executable] : outputs.map(t => t.file.get());
  ui.emit({ type: "run.end", command: "build", subject: open.root.name, artifacts });

  if (flags.start) {
    if (!executable) throw new ShardError("usage", `"${basename(open.build.rootDir)}" is not an executable module`);
    const name = open.root.name;
    ui.emit({ type: "program.start", name });
    const proc = spawnSync(executable, [], { stdio: "inherit" });
    if (proc.error) throw proc.error;
    ui.emit({ type: "program.end", name, status: proc.status ?? 0 });
    process.exit(proc.status ?? 0);
  }
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
