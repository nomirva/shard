import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "fs";
import { basename, join } from "path";
import { runSync } from "../utils/process";
import { ShardError } from "../utils/errors";
import { DIRS } from "../utils/constants";
import type { LinkType } from "../module/types";
import type { GitDependency, InstallEnvironment, InstallResult } from "./types";
import {
  altVersionRef,
  cloneRef,
  describePin,
  dirName,
  makePin,
  pinFromSuffix,
  pinVersion,
  reconcile,
  type GitPin,
} from "./integrity";

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

export async function installGit(
  dep: GitDependency,
  env: InstallEnvironment,
): Promise<InstallResult> {
  const modulesDir = join(env.rootPath, DIRS.MODULES);
  const cleanRepo = dep.repo.replace(/\.git$/, "");
  const repoUrl = env.gitProtocol === "ssh"
    ? sshUrl(cleanRepo)
    : `${env.gitProtocol}://${cleanRepo}.git`;

  const installed = findInstalled(modulesDir, dep.name);
  if (installed) {
    switch (reconcile(dep.pin, installed.pin)) {
      case "reuse":
        return { kind: "module", path: installed.path, name: dep.name };
      case "conflict":
        throw new ShardError(
          "conflict",
          `Version conflict for "${dep.name}": installed ${describePin(installed.pin)}, requested ${describePin(dep.pin)}`,
          "one pinned state per module can be installed at a time",
        );
      case "reinstall":
        rmSync(installed.path, { recursive: true, force: true });
    }
  }

  const targetDir = join(modulesDir, dirName(dep.name, dep.pin));
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(modulesDir, { recursive: true });

  let ref = cloneRef(dep.pin, dep.subdir);
  let result = await clone(repoUrl, targetDir, ref, dep.subdir !== undefined, env.onProgress);

  if (result.code !== 0 && dep.pin.kind === "version") {
    const alt = altVersionRef(dep.pin, dep.subdir);
    if (alt && alt !== ref) {
      rmSync(targetDir, { recursive: true, force: true });
      ref = alt;
      result = await clone(repoUrl, targetDir, alt, dep.subdir !== undefined, env.onProgress);
    }
  }

  if (result.code !== 0) {
    rmSync(targetDir, { recursive: true, force: true });
    throw cloneError(ref, repoUrl, result.err);
  }

  if (dep.subdir) {
    const sparse = runSync("git", ["sparse-checkout", "set", dep.subdir], targetDir);
    if (sparse.status !== 0 || !existsSync(join(targetDir, dep.subdir))) {
      rmSync(targetDir, { recursive: true, force: true });
      throw new ShardError(
        "git",
        `Sparse checkout failed for "${dep.subdir}"`,
        sparse.stderr || sparse.stdout,
      );
    }
    moveContentsUp(targetDir, dep.subdir);
    removeEmptyParentDirs(targetDir, dep.subdir);
  }

  rmSync(join(targetDir, ".git"), { recursive: true, force: true });
  return { kind: "module", path: targetDir, name: dep.name };
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

interface Installed {
  path: string;
  pin: GitPin;
}

function findInstalled(modulesDir: string, name: string): Installed | null {
  if (!existsSync(modulesDir)) return null;
  const matches = readdirSync(modulesDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && (e.name === name || e.name.startsWith(name + "@")))
    .map(e => ({ path: join(modulesDir, e.name), pin: pinFromSuffix(name, e.name) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return matches[0] ?? null;
}

function clone(
  repoUrl: string,
  targetDir: string,
  ref: string | null,
  sparse: boolean,
  onTransfer?: (percent: number) => void,
): Promise<{ code: number; err: string }> {
  const args = ["clone", "--depth", "1", "--progress"];
  if (ref) args.push("--branch", ref);
  if (sparse) args.push("--sparse");
  args.push(repoUrl, targetDir);

  return new Promise((resolve) => {
    const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let lastPercent = -1;

    const scan = (s: string): void => {
      const re = /(?:Receiving objects|Resolving deltas):\s*(\d+)%/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const p = Number(m[1]);
        if (p > lastPercent) {
          lastPercent = p;
          onTransfer?.(p);
        }
      }
    };

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); scan(stderr); });
    proc.on("error", (e: Error) => resolve({ code: -1, err: e.message }));
    proc.on("close", (code) => resolve({ code: code ?? -1, err: (stderr || stdout).trim() }));
  });
}

function cloneError(ref: string | null, url: string, err: string): ShardError {
  if (ref) return new ShardError("git", `Ref "${ref}" not found for ${url}`, err);
  return new ShardError("git", "git clone failed", err || `could not clone ${url}`);
}

function sshUrl(clean: string): string {
  const slash = clean.indexOf("/");
  if (slash === -1) {
    throw new ShardError("config", `Invalid git source: "${clean}"`, 'expected "user/repo"');
  }
  return `git@${clean.slice(0, slash)}:${clean.slice(slash + 1)}.git`;
}

function moveContentsUp(dir: string, sub: string): void {
  const src = join(dir, sub);
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dir, e.name);
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    renameSync(s, d);
  }
  rmSync(src, { recursive: true, force: true });
}

function removeEmptyParentDirs(dir: string, sub: string): void {
  const parts = sub.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = join(dir, ...parts.slice(0, i + 1));
    if (!existsSync(p)) continue;
    if (readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
  }
}
