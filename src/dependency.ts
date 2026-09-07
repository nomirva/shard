import { spawnSync } from "child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, readdirSync, renameSync } from "fs";
import { basename, join, resolve } from "path";
import { semver } from "bun";
import { LinkType } from "./types";
import type { Project } from "./project";
import { Module } from "./module";

export interface DependencyInfo {
  name: string;
  version?: string | null;
}

export abstract class Dependency {
  abstract readonly info: DependencyInfo;
  abstract readonly linkType?: LinkType;
  abstract install(project: Project, parent: Module): Module | null;

  get label(): string {
    const parts = [this.info.name, this.linkType ?? `default (static)`].filter(Boolean);
    return parts.join(" ");
  }

  static parse(triplet: string): Dependency {
    let linkType: LinkType | undefined;

    if (triplet.endsWith("+static")) {
      linkType = LinkType.Static;
      triplet = triplet.slice(0, -7);
    } else if (triplet.endsWith("+shared") || triplet.endsWith("+dynamic")) {
      linkType = LinkType.Shared;
      triplet = triplet.endsWith("+shared") ? triplet.slice(0, -7) : triplet.slice(0, -8);
    }

    const colonIdx = triplet.indexOf(":");
    if (colonIdx === -1) throw new Error(`Invalid dependency format: "${triplet}"`);

    const prefix = triplet.slice(0, colonIdx);
    const value = triplet.slice(colonIdx + 1);

    switch (prefix) {
      case "git": return new GitDependency(value, linkType);
      case "local": return new LocalDependency(value, linkType);
      case "sys": return new SysDependency(value, linkType);
      case "framework": return new FrameworkDependency(value, linkType);
      default: throw new Error(`Unknown dependency prefix: "${prefix}"`);
    }
  }
}

type Pin =
  | { type: "version"; value: string }
  | { type: "ref"; value: string }
  | { type: "head" };

function isSemver(s: string): boolean {
  try { semver.order(s, s); return true; } catch { return false; }
}

function dirName(name: string, pin: Pin): string {
  return pin.type === "head" ? name : `${name}@${pin.value}`;
}

function pinFromSuffix(name: string, dir: string): Pin {
  const prefix = name + "@";
  if (!dir.startsWith(prefix)) return { type: "head" };
  const value = dir.slice(prefix.length);
  return isSemver(value) ? { type: "version", value } : { type: "ref", value };
}

export class GitDependency extends Dependency {
  readonly linkType?: LinkType;
  readonly name: string;
  private repo: string;
  private pin: Pin;
  private subdir?: string;

  get version(): string | null {
    return this.pin.type === "version" ? this.pin.value : null;
  }

  get info(): DependencyInfo {
    return { name: this.name, version: this.version };
  }

  constructor(value: string, linkType?: LinkType) {
    super();
    this.linkType = linkType;

    const atIdx = value.indexOf("@");
    const raw = atIdx !== -1 ? value.slice(0, atIdx) : value;
    const spec = atIdx !== -1 ? value.slice(atIdx + 1) : undefined;

    let pin: string | undefined;
    if (spec !== undefined) {
      const slashIdx = spec.indexOf("//");
      if (slashIdx !== -1) {
        pin = spec.slice(0, slashIdx);
        this.subdir = spec.slice(slashIdx + 2);
      } else {
        pin = spec;
      }
    }

    this.pin = pin === undefined
      ? { type: "head" }
      : isSemver(pin)
        ? { type: "version", value: pin }
        : { type: "ref", value: pin };

    this.repo = raw;
    this.name = this.subdir
      ? basename(this.subdir.replace(/[/\\]/g, "/"))
      : raw.replace(/\.git$/, "").split("/").pop() || "repo";
  }

  install(project: Project, _parent: Module): Module | null {
    const modulesDir = join(project.rootPath, DIRS_MODULES);
    const protocol = project.config.gitProtocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https";
    const clean = this.repo.replace(/\.git$/, "");
    const repoUrl = protocol === "ssh"
      ? buildSshUrl(clean)
      : `${protocol}://${clean}.git`;

    const installed = findInstalled(modulesDir, this.name);

    if (installed) {
      const action = reconcile(this.pin, installed.pin);
      if (action === "reuse") return new Module(installed.path, this.name);
      if (action === "conflict") throw new Error(
        `Version conflict for "${this.name}": installed ${describePin(installed.pin)}, requested ${describePin(this.pin)}`
      );
      // action === "reinstall"
      rmSync(installed.path, { recursive: true, force: true });
    }

    const targetDir = join(modulesDir, dirName(this.name, this.pin));
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    const branch = cloneRef(this.pin, this.subdir);
    if (this.subdir) {
      const cloneArgs = branch
        ? ["clone", "--depth", "1", "--branch", branch, "--sparse", repoUrl, targetDir]
        : ["clone", "--depth", "1", "--sparse", repoUrl, targetDir];
      const r = spawnSync("git", cloneArgs, { stdio: "pipe" });
      if (r.status !== 0) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new Error(branch
          ? `Tag "${branch}" not found for ${repoUrl}: ${(r.stderr?.toString() || "").trim()}`
          : (r.stderr?.toString() || "git clone failed").trim());
      }

      const co = spawnSync("git", ["sparse-checkout", "set", this.subdir], { stdio: "pipe", cwd: targetDir });
      if (co.status !== 0) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new Error(`Sparse checkout failed for "${this.subdir}" in ${repoUrl}: ${(co.stderr?.toString() || "").trim()}`);
      }

      const pkgDir = join(targetDir, this.subdir);
      if (!existsSync(pkgDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new Error(`Package "${this.subdir}" not found in ${repoUrl}`);
      }

      moveContentsUp(targetDir, this.subdir);
      removeEmptyParentDirs(targetDir, this.subdir);
    } else {
      const args = branch
        ? ["clone", "--depth", "1", "--branch", branch, repoUrl, targetDir]
        : ["clone", "--depth", "1", repoUrl, targetDir];
      const r = spawnSync("git", args, { stdio: "pipe" });
      if (r.status !== 0) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new Error(branch
          ? `Tag "${branch}" not found for ${repoUrl}: ${(r.stderr?.toString() || "").trim()}`
          : (r.stderr?.toString() || "git clone failed").trim());
      }
    }

    rmSync(join(targetDir, ".git"), { recursive: true, force: true });
    return new Module(targetDir, this.name);
  }
}

function describePin(pin: Pin): string {
  if (pin.type === "version") return pin.value;
  if (pin.type === "ref") return `branch:${pin.value}`;
  return "HEAD";
}

function cloneRef(pin: Pin, subdir?: string): string | null {
  if (pin.type === "version") {
    return subdir ? `${subdir}/${pin.value}` : pin.value;
  }
  if (pin.type === "ref") return pin.value;
  return null;
}

type Action = "reuse" | "reinstall" | "conflict";

function pinsEqual(a: Pin, b: Pin): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "head") return true;
  return (a as { value: string }).value === (b as { value: string }).value;
}

function findInstalled(modulesDir: string, name: string): { path: string; pin: Pin } | null {
  if (!existsSync(modulesDir)) return null;
  const matches = readdirSync(modulesDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && (e.name === name || e.name.startsWith(name + "@")))
    .map(e => ({ path: join(modulesDir, e.name), pin: pinFromSuffix(name, e.name) }));
  if (matches.length === 0) return null;
  return matches[0];
}

function reconcile(requested: Pin, installed: Pin): Action {
  // identical request re-encountered (including HEAD) → reuse installed copy
  if (pinsEqual(requested, installed)) return "reuse";

  // two floating (null-version) requests that differ → unresolvable
  if (requested.type !== "version" && installed.type !== "version") {
    return "conflict";
  }

  // one side pinned to a version, the other floating → not reconcilable
  if (requested.type !== "version" || installed.type !== "version") {
    return "conflict";
  }

  const req = requested.value;
  const instVersion = installed.value;

  if (!isSemver(instVersion))
    throw new Error(`Invalid SemVer recorded for installed module: "${instVersion}"`);
  if (!isSemver(req))
    throw new Error(`Invalid SemVer for dependency: "${req}"`);

  if (req.split(".")[0] !== instVersion.split(".")[0]) return "conflict";
  if (semver.order(req, instVersion) > 0) return "reinstall";
  return "reuse";
}

export class LocalDependency extends Dependency {
  readonly linkType?: LinkType;
  readonly ref: string;

  get info(): DependencyInfo {
    const abs = resolve(this.ref);
    const p = join(abs, "shard.json");
    let name = basename(abs);
    let version: string | undefined;
    if (existsSync(p)) {
      try {
        const pkg = JSON.parse(readFileSync(p, "utf-8"));
        if (pkg.name) name = pkg.name;
        version = pkg.version;
      } catch {}
    }
    return { name, version };
  }

  constructor(value: string, linkType?: LinkType) {
    super();
    this.linkType = linkType;
    this.ref = value;
  }

  install(_project: Project, parent: Module): Module | null {
    const abs = resolve(parent.path, this.ref);
    return new Module(abs);
  }
}

export class SysDependency extends Dependency {
  readonly linkType?: LinkType;
  readonly lib: string;

  get info(): DependencyInfo {
    return { name: `sys:${this.lib}` };
  }

  constructor(value: string, linkType?: LinkType) {
    super();
    this.linkType = linkType;
    this.lib = value;
  }

  install(_project: Project, parent: Module): Module | null {
    const isMac = process.platform === "darwin";
    if (this.linkType === LinkType.Static && !isMac) {
      parent.libFlags.push("-Wl,-Bstatic", `-l${this.lib}`, "-Wl,-Bdynamic");
    } else {
      if (this.linkType === LinkType.Static) {
        process.stderr.write(`Warning: "${this.lib}" — -Bstatic unavailable on macOS, linking dynamically\n`);
      }
      parent.libFlags.push(`-l${this.lib}`);
    }
    return null;
  }
}

export class FrameworkDependency extends Dependency {
  readonly linkType?: LinkType;
  readonly framework: string;

  get info(): DependencyInfo {
    return { name: `framework:${this.framework}` };
  }

  constructor(value: string, linkType?: LinkType) {
    super();
    this.linkType = linkType;
    this.framework = value;
  }

  install(_project: Project, parent: Module): Module | null {
    if (this.linkType === LinkType.Static) {
      process.stderr.write(`Warning: "${this.framework}" — framework cannot be linked statically, linking dynamically\n`);
    }
    parent.libFlags.push(`-Wl,-framework,${this.framework}`);
    return null;
  }
}

const DIRS_MODULES = "modules";

function buildSshUrl(clean: string): string {
  const slash = clean.indexOf("/");
  if (slash === -1) throw new Error(`Invalid git source: "${clean}"`);
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
