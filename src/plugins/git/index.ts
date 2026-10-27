import { join } from "path";
import { service, type DependencyNotation, type NotationHandler } from "../../core";
import { parseGit, gitSource } from "../../dependency/sources/git/source";
import { ModuleStore } from "../../dependency/store";
import { LinkType } from "../../lang/types";
import { ShardError } from "../../utils/errors";
import { DIRS } from "../../workspace/layout";

export interface GitParameters {
  /** https (default), ssh, http or file. */
  readonly protocol: string;
}

export const GIT_PARAMETERS = service<GitParameters>("git.parameters");

export interface GitOptions {
  /** A SemVer tag ("v1.2.0"), a branch or any ref. */
  readonly ref?: string;
  readonly version?: string;
  readonly branch?: string;
  /** A sub-package of a monorepo; its tags are "<subdir>/<version>". */
  readonly subdir?: string;
  readonly linkage?: "static" | "shared";
}

interface GitNotation extends DependencyNotation {
  readonly source: "git";
  /** The `depend` form: "host/user/repo[//subdir][@ref]". */
  readonly spec: string;
  readonly linkage?: "static" | "shared";
}

/**
 * `git("github.com/user/lib", { version: "v1.2.0" })` or the short form
 * `git("github.com/user/lib@v1.2.0")`. Checked out into the root's
 * `modules/` during initialization; one installed version per name.
 */
export const gitNotation: NotationHandler = {
  source: "git",

  helper(repo: string, options: GitOptions = {}): GitNotation {
    if (typeof repo !== "string" || repo === "") throw new ShardError("config", "git() needs a repository");
    const ref = options.version ?? options.branch ?? options.ref;
    const spec = repo + (options.subdir ? `//${options.subdir}` : "") + (ref ? `@${ref}` : "");
    return {
      source: "git",
      spec,
      ...(options.linkage ? { linkage: options.linkage, attributes: { linkage: options.linkage } } : {}),
    };
  },

  describe(notation) {
    const dep = parse(notation as GitNotation);
    return { name: dep.name, source: "git", spec: gitSource.spec(dep), link: dep.link };
  },

  async resolve(notation, from, { requestedBy, dryRun, onProgress }) {
    const dep = parse(notation as GitNotation);
    const spec = (notation as GitNotation).spec;
    const protocol = from.services.find(GIT_PARAMETERS)?.protocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https";
    const decision = gitSource.decide(dep, {
      rootPath: from.rootDir,
      store: new ModuleStore(join(from.rootDir, DIRS.MODULES)),
      gitProtocol: protocol,
      requestedBy,
      onProgress,
    });
    if (decision.kind !== "module") throw new ShardError("git", `${spec} is not a module`);
    if (decision.install) {
      if (dryRun) return { kind: "missing" };
      await decision.install();
    }
    return {
      kind: "module",
      dir: decision.path,
      name: decision.name,
      note: { action: decision.action, previous: decision.previous },
    };
  },
};

function parse(notation: GitNotation) {
  const { spec, linkage } = notation;
  return parseGit(spec, linkage === "shared" ? LinkType.Shared : linkage === "static" ? LinkType.Static : null);
}
