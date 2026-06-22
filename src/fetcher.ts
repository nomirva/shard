import { basename, join, resolve } from "path";
import { existsSync, mkdirSync, rmSync, cpSync, symlinkSync } from "fs";
import { spawnSync } from "child_process";
import { HOST_TARGET } from "./toolchain/types";
import { Manifest, Version } from "./manifest";

function repoNameFromUrl(url: string): string {
  return url.replace(/\.git$/, "").split("/").pop() || "repo";
}

export class Fetcher {
  static git(url: string, rootDir: string, version?: string): string {
    const name = repoNameFromUrl(url);
    const targetDir = join(rootDir, "modules", name);
    const installed = Manifest.readVersion(targetDir);

    if (installed && !Version.parse(installed))
      throw new Error(`Invalid SemVer in module.json for "${name}": "${installed}"`);
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

    const args = version
      ? ["clone", "--depth", "1", "--branch", version, url, targetDir]
      : ["clone", "--depth", "1", url, targetDir];

    const result = spawnSync("git", args, { stdio: "pipe", cwd: rootDir });
    if (result.status !== 0) {
      if (version) {
        const msg = result.stderr?.toString() || "";
        throw new Error(`Tag "${version}" not found for ${url}: ${msg.trim()}`);
      }
      rmSync(targetDir, { recursive: true, force: true });
      const msg = result.stderr?.toString() || result.stdout?.toString() || "git clone failed";
      throw new Error(msg.trim());
    }

    rmSync(join(targetDir, ".git"), { recursive: true, force: true });
    if (version) Manifest.writeVersion(targetDir, version);
    return targetDir;
  }

  static local(srcPath: string, rootDir: string): string {
    const resolved = resolve(srcPath);
    const name = basename(resolved);
    const targetDir = join(rootDir, "modules", name);
    if (existsSync(targetDir)) return targetDir;

    try {
      if (HOST_TARGET.platform === "win32") {
        symlinkSync(resolved, targetDir, "junction");
      } else {
        symlinkSync(resolved, targetDir);
      }
    } catch {
      cpSync(resolved, targetDir, { recursive: true, filter: (src) => !src.includes(".git") });
    }
    return targetDir;
  }
}
