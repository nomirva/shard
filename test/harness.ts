import { spawnSync } from "child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";

export const REPO = join(import.meta.dir, "..");
const SANDBOX_ROOT = join(REPO, ".sandbox");
const SHIM_DIR = join(SANDBOX_ROOT, "_bin");
const SHIM_LOG = join(SANDBOX_ROOT, "_invocations.log");

function realTool(name: string): string {
  const r = spawnSync("which", [name], { stdio: "pipe" });
  return r.stdout.toString().trim();
}

function installShims(): void {
  mkdirSync(SHIM_DIR, { recursive: true });
  for (const tool of ["clang", "ar"]) {
    const shim = join(SHIM_DIR, tool);
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        `if [ "$1" != "--version" ]; then`,
        `  { printf '%s\\t%s' "${tool}" "$PWD"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$SHIM_LOG"`,
        "fi",
        `exec "${realTool(tool)}" "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  }
}

export class Sandbox {
  readonly dir: string;

  constructor(name: string) {
    this.dir = join(SANDBOX_ROOT, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    copyTracked(join(REPO, "examples"), join(this.dir, "examples"));
    cpSync(join(REPO, "test", "fixtures"), join(this.dir, "fixtures"), { recursive: true });
    installShims();
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  write(rel: string, content: string): void {
    const file = this.path(rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  run(args: string[], cwd: string = this.dir, extraEnv: Record<string, string> = {}): RunSnapshot {
    rmSync(SHIM_LOG, { force: true });
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    delete env.FORCE_COLOR;
    delete env.SHARD_GIT_PROTOCOL;
    Object.assign(env, { PATH: `${SHIM_DIR}:${env.PATH}`, SHIM_LOG, NO_COLOR: "1" }, extraEnv);

    const r = spawnSync("bun", [join(REPO, "shard.ts"), ...args], { cwd, env, stdio: "pipe" });
    const log = existsSync(SHIM_LOG) ? readFileSync(SHIM_LOG, "utf-8") : "";
    return {
      args: args.map(a => this.normalize(a)),
      status: r.status,
      stdout: normalizeOutput(this.normalize(r.stdout.toString())),
      stderr: normalizeOutput(this.normalize(r.stderr.toString())),
      invocations: log.split("\n").filter(Boolean).map(line => this.normalize(line).split("\t")),
    };
  }

  tree(rel = "."): string[] {
    const base = this.path(rel);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === ".DS_Store") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else out.push(relative(base, full));
      }
    };
    walk(base);
    return out.sort();
  }

  read(rel: string): string | null {
    const file = this.path(rel);
    return existsSync(file) ? this.normalize(readFileSync(file, "utf-8")) : null;
  }

  normalize(s: string): string {
    return s.split(this.dir).join("$SB").split(REPO).join("$REPO");
  }
}

export interface RunSnapshot {
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  invocations: string[][];
}

/** Timings, sizes and the compiler version differ between runs and machines. */
function normalizeOutput(s: string): string {
  return s
    .replace(/\b\d+(\.\d+)?(ms|s)\b/g, "<t>")
    .replace(/\b\d+(\.\d+)? (B|KB|MB|GB)\b/g, "<size>")
    .replace(/clang \d+\.\d+(\.\d+)?/g, "clang <ver>");
}

function copyTracked(src: string, dest: string): void {
  const r = spawnSync("git", ["ls-files", "--", "."], { cwd: src, stdio: "pipe" });
  for (const rel of r.stdout.toString().split("\n").filter(Boolean)) {
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(src, rel), target);
  }
}

export function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
}
