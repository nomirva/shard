import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, renameSync, readFileSync } from "fs";
import { basename, join, resolve as resolvePath } from "path";
import { semver } from "bun";
import { LinkType } from "./types";
import { DIRS } from "./constants";
import type { Project } from "./project";
import { Module } from "./module";
import { ShardError } from "./errors";

export type InstallResult = { module: Module } | { flags: string[] };

export interface InstallProgress {
  readonly name: string;
  readonly version: string | null;
  percent: number;
}

export interface ProgressView {
  name: string;
  version: string | null;
  index: number;
  total: number;
  percent: number;
}

export interface ProgressSink {
  line(view: ProgressView): void;
  end(): void;
}

export interface ResolveContext {
  project: Project;
  from: string;
  progress: InstallProgress;
  index: number;
  total: number;
}

export interface Dependency {
  readonly kind: string;
  readonly link: LinkType | null;
  readonly name: string;
  readonly version: string | null;
  install(ctx: ResolveContext): Promise<InstallResult>;
  describe(): string;
}

interface DependencySource {
  readonly prefix: string;
  parse(value: string, link: LinkType | null): Dependency;
}

// --- registry ---------------------------------------------------------------

const registry = new Map<string, DependencySource>();

function register(source: DependencySource): void {
  registry.set(source.prefix, source);
}

export function parseDependency(triplet: string): Dependency {
  let link: LinkType | null = null;

  if (triplet.endsWith("+static")) {
    link = LinkType.Static;
    triplet = triplet.slice(0, -7);
  } else if (triplet.endsWith("+shared") || triplet.endsWith("+dynamic")) {
    link = LinkType.Shared;
    triplet = triplet.endsWith("+shared") ? triplet.slice(0, -7) : triplet.slice(0, -8);
  }

  const colonIdx = triplet.indexOf(":");
  if (colonIdx === -1) {
    throw new ShardError(
      "config",
      `Invalid dependency format: "${triplet}"`,
      'expected one of: git:user/repo[@ref], local:../path, sys:z, framework:Cocoa',
    );
  }

  const prefix = triplet.slice(0, colonIdx);
  const value = triplet.slice(colonIdx + 1);
  const source = registry.get(prefix);
  if (!source) {
    throw new ShardError(
      "config",
      `Unknown dependency prefix "${prefix}"`,
      `supported prefixes: ${[...registry.keys()].join(", ")}`,
    );
  }
  return source.parse(value, link);
}

// --- git --------------------------------------------------------------------

type GitPin =
  | { kind: "version"; value: string }
  | { kind: "branch"; value: string }
  | { kind: "head" };

interface GitSpec {
  repo: string;
  pin: GitPin;
  subdir?: string;
  name: string;
}

class GitSource implements DependencySource {
  readonly prefix = "git";

  parse(value: string, link: LinkType | null): Dependency {
    return new GitDependency(parseGitSpec(value), link);
  }
}

class GitDependency implements Dependency {
  readonly kind = "git";
  readonly link: LinkType | null;
  readonly name: string;
  private readonly repo: string;
  private readonly pin: GitPin;
  private readonly subdir?: string;

  constructor(spec: GitSpec, link: LinkType | null) {
    this.link = link;
    this.name = spec.name;
    this.repo = spec.repo;
    this.pin = spec.pin;
    this.subdir = spec.subdir;
  }

  get version(): string | null {
    if (this.pin.kind === "version") return prefixV(this.pin.value);
    if (this.pin.kind === "branch") return this.pin.value;
    return null;
  }

  describe(): string {
    return `${this.name} ${this.link ?? "default (static)"}`;
  }

  async install(ctx: ResolveContext): Promise<InstallResult> {
    const project = ctx.project;
    const modulesDir = join(project.rootPath, DIRS.MODULES);
    const protocol = project.config.gitProtocol ?? process.env.SHARD_GIT_PROTOCOL ?? "https";
    const cleanRepo = this.repo.replace(/\.git$/, "");
    const repoUrl = protocol === "ssh"
      ? sshUrl(cleanRepo)
      : `${protocol}://${cleanRepo}.git`;

    const installed = findInstalled(modulesDir, this.name);
    if (installed) {
      switch (reconcile(this.pin, installed.pin)) {
        case "reuse": return { module: new Module(installed.path, this.name) };
        case "conflict":
          throw new ShardError(
            "conflict",
            `Version conflict for "${this.name}": installed ${describePin(installed.pin)}, requested ${describePin(this.pin)}`,
            "one pinned state per module can be installed at a time",
          );
        case "reinstall":
          rmSync(installed.path, { recursive: true, force: true });
      }
    }

    const targetDir = join(modulesDir, dirName(this.name, this.pin));
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(modulesDir, { recursive: true });

    const ref = cloneRef(this.pin, this.subdir);
    const cloneArgs = ["clone", "--depth", "1", "--progress"];
    if (ref) cloneArgs.push("--branch", ref);
    if (this.subdir) cloneArgs.push("--sparse");
    cloneArgs.push(repoUrl, targetDir);

    const clone = await runGit(cloneArgs, undefined, (percent) => {
      ctx.progress.percent = percent;
    });
    if (clone.code !== 0) {
      rmSync(targetDir, { recursive: true, force: true });
      throw cloneError(ref, repoUrl, clone.err);
    }

    if (this.subdir) {
      const sparse = git(["sparse-checkout", "set", this.subdir], targetDir);
      if (sparse.code !== 0) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new ShardError("git", `Sparse checkout failed for "${this.subdir}"`, sparse.err);
      }

      const pkgDir = join(targetDir, this.subdir);
      if (!existsSync(pkgDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        throw new ShardError("git", `Package "${this.subdir}" not found in ${repoUrl}`);
      }

      moveContentsUp(targetDir, this.subdir);
      removeEmptyParentDirs(targetDir, this.subdir);
    }

    rmSync(join(targetDir, ".git"), { recursive: true, force: true });
    return { module: new Module(targetDir, this.name) };
  }
}

function parseGitSpec(value: string): GitSpec {
  const slashIdx = value.indexOf("//");

  if (slashIdx === -1) {
    const { head, ref } = splitRef(value);
    return buildGitSpec(head, ref, undefined);
  }

  // monorepo sub-package: "repo//subdir[@ref]" (canonical) or "repo[@ref]//subdir"
  const left = splitRef(value.slice(0, slashIdx));
  const right = splitRef(value.slice(slashIdx + 2));
  const ref = left.ref !== undefined ? left.ref : right.ref;
  return buildGitSpec(left.head, ref, right.head);
}

function splitRef(part: string): { head: string; ref?: string } {
  const at = part.indexOf("@");
  if (at === -1) return { head: part };
  return { head: part.slice(0, at), ref: part.slice(at + 1) || undefined };
}

function buildGitSpec(repo: string, ref: string | undefined, subdir: string | undefined): GitSpec {
  const pin: GitPin = ref === undefined
    ? { kind: "head" }
    : isSemver(ref)
      ? { kind: "version", value: ref }
      : { kind: "branch", value: ref };

  const name = subdir
    ? basename(subdir.replace(/[/\\]/g, "/"))
    : repo.replace(/\.git$/, "").split("/").pop() || "repo";

  return subdir ? { repo, pin, subdir, name } : { repo, pin, name };
}

// --- local ------------------------------------------------------------------

class LocalSource implements DependencySource {
  readonly prefix = "local";

  parse(value: string, link: LinkType | null): Dependency {
    return new LocalDependency(value, link);
  }
}

class LocalDependency implements Dependency {
  readonly kind = "local";
  readonly link: LinkType | null;
  readonly name: string;
  readonly version: string | null = null;
  private readonly target: string;

  constructor(target: string, link: LinkType | null) {
    this.link = link;
    this.target = target;
    this.name = basename(resolvePath(target));
  }

  describe(): string {
    const p = join(resolvePath(this.target), "shard.json");
    let name = this.name;
    if (existsSync(p)) {
      try {
        const pkg = JSON.parse(readFileSync(p, "utf-8"));
        if (pkg.name) name = pkg.name;
      } catch { /* keep basename */ }
    }
    return `${name} ${this.link ?? "default (static)"}`;
  }

  async install(ctx: ResolveContext): Promise<InstallResult> {
    return { module: new Module(resolvePath(ctx.from, this.target)) };
  }
}

// --- linker flags (sys / framework) -----------------------------------------

class LinkSource implements DependencySource {
  readonly prefix: "sys" | "framework";

  constructor(prefix: "sys" | "framework") {
    this.prefix = prefix;
  }

  parse(value: string, link: LinkType | null): Dependency {
    return new LinkDependency(this.prefix, value, link);
  }
}

class LinkDependency implements Dependency {
  readonly kind: string;
  readonly link: LinkType | null;
  readonly name: string;
  readonly version: string | null = null;
  private readonly mode: "sys" | "framework";
  private readonly value: string;

  constructor(mode: "sys" | "framework", value: string, link: LinkType | null) {
    this.kind = mode;
    this.link = link;
    this.name = `${mode}:${value}`;
    this.mode = mode;
    this.value = value;
  }

  describe(): string {
    return `${this.name} ${this.link ?? "default (static)"}`;
  }

  async install(_ctx: ResolveContext): Promise<InstallResult> {
    if (this.mode === "sys") {
      const isMac = process.platform === "darwin";
      if (this.link === LinkType.Static) {
        if (!isMac) {
          return { flags: ["-Wl,-Bstatic", `-l${this.value}`, "-Wl,-Bdynamic"] };
        }
        warn(`"${this.value}" — -Bstatic unavailable on macOS, linking dynamically`);
      }
      return { flags: [`-l${this.value}`] };
    }

    if (this.link === LinkType.Static) {
      warn(`"${this.value}" — framework cannot be linked statically, linking dynamically`);
    }
    return { flags: [`-Wl,-framework,${this.value}`] };
  }
}

function warn(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

// --- git process helpers ----------------------------------------------------

function git(args: string[], cwd?: string): { code: number; err: string } {
  const r = spawnSync("git", args, { stdio: "pipe", cwd });
  return {
    code: r.status ?? -1,
    err: (r.stderr?.toString() || r.stdout?.toString() || "").trim(),
  };
}

function runGit(
  args: string[],
  cwd: string | undefined,
  onTransfer: (percent: number) => void,
): Promise<{ code: number; err: string }> {
  return new Promise((resolvePromise) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
          onTransfer(p);
        }
      }
    };

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });

    proc.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      scan(s);
    });

    proc.on("error", (e: Error) => resolvePromise({ code: -1, err: e.message }));
    proc.on("close", (code) =>
      resolvePromise({ code: code ?? -1, err: (stderr || stdout).trim() }),
    );
  });
}

function cloneError(ref: string | null, url: string, err: string): ShardError {
  if (ref) return new ShardError("git", `Tag "${ref}" not found for ${url}`, err);
  return new ShardError("git", "git clone failed", err || `could not clone ${url}`);
}

function sshUrl(clean: string): string {
  const slash = clean.indexOf("/");
  if (slash === -1) {
    throw new ShardError("config", `Invalid git source: "${clean}"`, 'expected "user/repo"');
  }
  return `git@${clean.slice(0, slash)}:${clean.slice(slash + 1)}.git`;
}

// --- pin helpers ------------------------------------------------------------

function prefixV(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function isSemver(s: string): boolean {
  try { semver.order(s, s); return true; } catch { return false; }
}

function dirName(name: string, pin: GitPin): string {
  return pin.kind === "head" ? name : `${name}@${pin.value}`;
}

function pinFromSuffix(name: string, dir: string): GitPin {
  const prefix = name + "@";
  if (!dir.startsWith(prefix)) return { kind: "head" };
  const value = dir.slice(prefix.length);
  return isSemver(value) ? { kind: "version", value } : { kind: "branch", value };
}

function describePin(pin: GitPin): string {
  if (pin.kind === "version") return pin.value;
  if (pin.kind === "branch") return `branch:${pin.value}`;
  return "HEAD";
}

function cloneRef(pin: GitPin, subdir?: string): string | null {
  if (pin.kind === "version") return subdir ? `${subdir}/${pin.value}` : pin.value;
  if (pin.kind === "branch") return pin.value;
  return null;
}

function pinsEqual(a: GitPin, b: GitPin): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "head") return true;
  return (a as { value: string }).value === (b as { value: string }).value;
}

function findInstalled(modulesDir: string, name: string): { path: string; pin: GitPin } | null {
  if (!existsSync(modulesDir)) return null;
  const matches = readdirSync(modulesDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && (e.name === name || e.name.startsWith(name + "@")))
    .map(e => ({ path: join(modulesDir, e.name), pin: pinFromSuffix(name, e.name) }));
  return matches[0] ?? null;
}

type Action = "reuse" | "reinstall" | "conflict";

function reconcile(requested: GitPin, installed: GitPin): Action {
  if (pinsEqual(requested, installed)) return "reuse";

  if (requested.kind !== "version" || installed.kind !== "version") return "conflict";

  const req = requested.value;
  const instVersion = installed.value;

  if (!isSemver(instVersion)) {
    throw new ShardError("config", `Invalid SemVer recorded for installed module: "${instVersion}"`);
  }
  if (!isSemver(req)) {
    throw new ShardError("config", `Invalid SemVer for dependency: "${req}"`);
  }

  if (req.split(".")[0] !== instVersion.split(".")[0]) return "conflict";
  if (semver.order(req, instVersion) > 0) return "reinstall";
  return "reuse";
}

// --- sparse checkout helpers -------------------------------------------------

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

register(new GitSource());
register(new LocalSource());
register(new LinkSource("sys"));
register(new LinkSource("framework"));
