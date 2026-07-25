import { basename, join, resolve } from "path";
import { existsSync, mkdirSync, rmSync, renameSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { Manifest, Version } from "./manifest";

function buildGitUrl(hostPath: string, protocol: string): string {
  const clean = hostPath.replace(/\.git$/, "");
  if (protocol === "ssh") {
    const slash = clean.indexOf("/");
    if (slash === -1) throw new Error(`Invalid git source: "${hostPath}"`);
    const host = clean.slice(0, slash);
    const path = clean.slice(slash + 1);
    return `git@${host}:${path}.git`;
  }
  return `${protocol}://${clean}.git`;
}

function moveUp(dir: string, sub: string): void {
  const src = join(dir, sub);
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dir, e.name);
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    renameSync(s, d);
  }
  rmSync(src, { recursive: true, force: true });
}

function removeEmptyParents(dir: string, sub: string): void {
  const parts = sub.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = join(dir, ...parts.slice(0, i + 1));
    if (!existsSync(p)) continue;
    const remaining = readdirSync(p);
    if (remaining.length === 0) rmSync(p, { recursive: true, force: true });
  }
}

export class Fetcher {
  static gitProtocol = "https";

  static git(url: string, rootDir: string, version?: string, pkg?: string): string {
    const repoUrl = buildGitUrl(url, Fetcher.gitProtocol);
    const name = pkg ? basename(pkg.replace(/[/\\]/g, '/')) : url.replace(/\.git$/, "").split("/").pop() || "repo";
    const targetDir = join(rootDir, "modules", name);
    const versionTag = pkg && version ? `${pkg}/${version}` : version;

    const installed = Manifest.readVersion(targetDir);

    if (installed && !Version.parse(installed))
      throw new Error(`Invalid SemVer in ${Manifest.FILE_NAME} for "${name}": "${installed}"`);
    if (version && !Version.parse(version))
      throw new Error(`Invalid SemVer for dependency "${name}" (${url}): "${version}"`);

    if (installed) {
      if (version && !Version.compatible(installed, version)) {
        throw new Error(`Version conflict for "${name}": installed ${installed}, requested ${version}`);
      }
      if (version && Version.newer(version, installed)) {
        rmSync(targetDir, { recursive: true, force: true });
      } else {
        return targetDir;
      }
    }

    if (existsSync(targetDir) && !installed) {
      if (version) throw new Error(`Version conflict for "${name}": installed from HEAD, requested ${version}`);
      return targetDir;
    }

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    if (pkg) {
      const sparseArgs = ["clone", "--depth", "1", "--branch", versionTag!, "--sparse", repoUrl, targetDir];
      const clone = spawnSync("git", sparseArgs, { stdio: "pipe", cwd: rootDir });
      if (clone.status !== 0) {
        const msg = clone.stderr?.toString() || "";
        throw new Error(`Tag "${versionTag}" not found for ${repoUrl}: ${msg.trim()}`);
      }

      const co = spawnSync("git", ["sparse-checkout", "set", pkg], { stdio: "pipe", cwd: targetDir });
      if (co.status !== 0) {
        rmSync(targetDir, { recursive: true, force: true });
        const msg = co.stderr?.toString() || "";
        throw new Error(`Sparse checkout failed for "${pkg}" in ${repoUrl}: ${msg.trim()}`);
      }

      const pkgDir = join(targetDir, pkg);
      if (!existsSync(pkgDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new Error(`Package "${pkg}" not found in ${repoUrl} at tag "${versionTag}"`);
      }

      moveUp(targetDir, pkg);
      removeEmptyParents(targetDir, pkg);
      rmSync(join(targetDir, ".git"), { recursive: true, force: true });
    } else {
      const args = versionTag
        ? ["clone", "--depth", "1", "--branch", versionTag, repoUrl, targetDir]
        : ["clone", "--depth", "1", repoUrl, targetDir];

      const result = spawnSync("git", args, { stdio: "pipe", cwd: rootDir });
      if (result.status !== 0) {
        if (versionTag) {
          const msg = result.stderr?.toString() || "";
          throw new Error(`Tag "${versionTag}" not found for ${repoUrl}: ${msg.trim()}`);
        }
        rmSync(targetDir, { recursive: true, force: true });
        const msg = result.stderr?.toString() || result.stdout?.toString() || "git clone failed";
        throw new Error(msg.trim());
      }

      rmSync(join(targetDir, ".git"), { recursive: true, force: true });
    }

    if (version) Manifest.writeVersion(targetDir, version);
    return targetDir;
  }

  static local(srcPath: string, _rootDir: string): string {
    return resolve(srcPath);
  }
}
