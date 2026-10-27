import { rmSync } from "fs";
import { basename } from "path";
import type { LinkType } from "../../../lang/types";
import { ShardError } from "../../../core/errors";
import type { Decision, Dependency, DependencySource, ResolveEnv } from "../../source";
import { installGit } from "./installer";
import { describePin, dirName, makePin, pinFromSuffix, pinVersion, reconcile, type GitPin } from "./pin";

export interface GitDependency extends Dependency {
  kind: "git";
  repo: string;
  pin: GitPin;
  subdir?: string;
}

export const gitSource: DependencySource<GitDependency> = {
  prefixes: ["git"],
  examples: ["git:user/repo[@ref]"],
  parse: (_prefix, value, link) => parseGit(value, link),

  decide(dep: GitDependency, env: ResolveEnv): Decision {
    const cleanRepo = dep.repo.replace(/\.git$/, "");
    const repoUrl = env.gitProtocol === "ssh"
      ? sshUrl(cleanRepo)
      : `${env.gitProtocol}://${cleanRepo}.git`;

    const installed = env.store.find(dep.name);
    let stale: string | null = null;
    if (installed) {
      switch (reconcile(dep.pin, pinFromSuffix(dep.name, installed.dirName))) {
        case "reuse":
          return { kind: "module", path: installed.path, name: dep.name };
        case "conflict":
          throw new ShardError(
            "conflict",
            `Version conflict for "${dep.name}": installed ${describePin(pinFromSuffix(dep.name, installed.dirName))}, requested ${describePin(dep.pin)}`,
            "one pinned state per module can be installed at a time",
          );
        case "reinstall":
          stale = installed.path;
      }
    }

    const targetDir = env.store.pathFor(dirName(dep.name, dep.pin));
    return {
      kind: "module",
      path: targetDir,
      name: dep.name,
      install: async () => {
        if (stale) rmSync(stale, { recursive: true, force: true });
        rmSync(targetDir, { recursive: true, force: true });
        env.store.ensure();
        await installGit({ repoUrl, targetDir, pin: dep.pin, subdir: dep.subdir, onProgress: env.onProgress });
      },
    };
  },
};

export function parseGit(value: string, link: LinkType | null): GitDependency {
  const slashIdx = value.indexOf("//");
  let repo: string;
  let ref: string | undefined;
  let subdir: string | undefined;

  if (slashIdx === -1) {
    const split = splitRef(value);
    repo = split.head;
    ref = split.ref;
  } else {
    ({ repo, ref, subdir } = monorepoParts(value, slashIdx));
  }

  const pin = makePin(ref);
  const name = subdir
    ? basename(subdir.replace(/[/\\]/g, "/"))
    : repo.replace(/\.git$/, "").split("/").pop() || "repo";

  return { kind: "git", link, name, version: pinVersion(pin), repo, pin, subdir };
}

function monorepoParts(value: string, slashIdx: number): { repo: string; ref?: string; subdir: string } {
  const left = splitRef(value.slice(0, slashIdx));
  const right = splitRef(value.slice(slashIdx + 2));
  return { repo: left.head, ref: left.ref ?? right.ref, subdir: right.head };
}

function splitRef(part: string): { head: string; ref?: string } {
  const at = part.indexOf("@");
  if (at === -1) return { head: part };
  return { head: part.slice(0, at), ref: part.slice(at + 1) || undefined };
}

function sshUrl(clean: string): string {
  const slash = clean.indexOf("/");
  if (slash === -1) {
    throw new ShardError("config", `Invalid git source: "${clean}"`, 'expected "user/repo"');
  }
  return `git@${clean.slice(0, slash)}:${clean.slice(slash + 1)}.git`;
}
