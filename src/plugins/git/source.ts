import { rmSync } from "fs";
import { basename } from "path";
import type { LinkType } from "../c/lang/types";
import { ShardError } from "../../utils/errors";
import type { ModuleStore } from "./store";
import { installGit } from "./installer";
import { describePin, dirName, makePin, pinFromSuffix, pinVersion, reconcile, type GitPin } from "./pin";

export interface GitDependency {
  readonly kind: "git";
  readonly link: LinkType | null;
  readonly name: string;
  readonly version: string | null;
  readonly repo: string;
  readonly pin: GitPin;
  readonly subdir?: string;
}

export interface ResolveEnv {
  readonly rootPath: string;
  readonly store: ModuleStore;
  readonly gitProtocol: string;
  /** Module names from the root to the module declaring this dependency. */
  readonly requestedBy: readonly string[];
  readonly onProgress?: (percent: number) => void;
}

/** Where a git dependency lives and how it gets there. Deciding only reads the store; `install` fetches. */
export interface Decision {
  readonly path: string;
  readonly name: string;
  readonly action: "reused" | "installed" | "upgraded";
  /** Pin being replaced when upgrading. */
  readonly previous?: string;
  readonly install?: () => Promise<void>;
}

export const gitSource = {
  /** Short human form of what is requested, e.g. "v1.2.0" or "libs/sub@v1.0.0". */
  spec: (dep: GitDependency): string => (dep.subdir ? `${dep.subdir}@` : "") + describePin(dep.pin),

  /** Reuse, install, reinstall or conflict — throws on conflict. */
  decide(dep: GitDependency, env: ResolveEnv): Decision {
    const cleanRepo = dep.repo.replace(/\.git$/, "");
    const repoUrl = env.gitProtocol === "ssh"
      ? sshUrl(cleanRepo)
      : `${env.gitProtocol}://${cleanRepo}.git`;

    const installed = env.store.find(dep.name);
    let stale: { path: string; pin: GitPin } | null = null;
    if (installed) {
      const installedPin = pinFromSuffix(dep.name, installed.dirName);
      switch (reconcile(dep.pin, installedPin)) {
        case "reuse":
          return { path: installed.path, name: dep.name, action: "reused" };
        case "conflict":
          throw new ShardError(
            "conflict",
            `${describePin(dep.pin)} requested by ${env.requestedBy.at(-1)}, but ${describePin(installedPin)} is installed`,
            "only one version of a module can be installed at a time",
          );
        case "reinstall":
          stale = { path: installed.path, pin: installedPin };
      }
    }

    const targetDir = env.store.pathFor(dirName(dep.name, dep.pin));
    return {
      path: targetDir,
      name: dep.name,
      action: stale ? "upgraded" : "installed",
      previous: stale ? describePin(stale.pin) : undefined,
      install: async () => {
        if (stale) rmSync(stale.path, { recursive: true, force: true });
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
