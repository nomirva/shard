import { spawn } from "child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { runSync } from "../../../utils/process";
import { ShardError } from "../../../utils/errors";
import { altVersionRef, cloneRef, type GitPin } from "./pin";

export interface GitInstall {
  repoUrl: string;
  targetDir: string;
  pin: GitPin;
  subdir?: string;
  onProgress?: (percent: number) => void;
}

/** Shallow clone (sparse for monorepo sub-packages), then strip `.git`. */
export async function installGit(job: GitInstall): Promise<void> {
  const { repoUrl, targetDir, pin, subdir, onProgress } = job;
  let ref = cloneRef(pin, subdir);
  let result = await clone(repoUrl, targetDir, ref, subdir !== undefined, onProgress);

  if (result.code !== 0 && pin.kind === "version") {
    const alt = altVersionRef(pin, subdir);
    if (alt && alt !== ref) {
      rmSync(targetDir, { recursive: true, force: true });
      ref = alt;
      result = await clone(repoUrl, targetDir, alt, subdir !== undefined, onProgress);
    }
  }

  if (result.code !== 0) {
    rmSync(targetDir, { recursive: true, force: true });
    throw cloneError(ref, repoUrl, result.err);
  }

  if (subdir) {
    const sparse = runSync("git", ["sparse-checkout", "set", subdir], targetDir);
    if (sparse.status !== 0 || !existsSync(join(targetDir, subdir))) {
      rmSync(targetDir, { recursive: true, force: true });
      throw new ShardError(
        "git",
        `Sparse checkout failed for "${subdir}"`,
        sparse.stderr || sparse.stdout,
      );
    }
    moveContentsUp(targetDir, subdir);
    removeEmptyParentDirs(targetDir, subdir);
  }

  rmSync(join(targetDir, ".git"), { recursive: true, force: true });
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
