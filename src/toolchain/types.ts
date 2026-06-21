import { spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";

export type OptLevel = `-O${string}`;
export type CStd = `-std=${string}`;
export type WarningSet = "none" | "default" | "extra" | "pedantic" | "all" | "error";
export type Subsystem = "console" | "windows" | "native" | "efi_application";

export interface TargetPlatform {
  platform: string;
  arch: string;
}

export const HOST_TARGET: TargetPlatform = {
  platform: process.platform,
  arch: process.arch,
};

export interface UserBuildOptions {
  optimize?: string;
  debug?: boolean;
  standard?: string;
  warnings?: WarningSet;
  defines?: string[];
  compileExtra?: string[];
  linkExtra?: string[];
  subsystem?: Subsystem;
}

export interface CompileOptions {
  includePaths: string[];
  target?: TargetPlatform;
  optimize?: OptLevel;
  debug?: boolean;
  standard?: CStd;
  warnings?: WarningSet;
  defines?: string[];
  extra?: string[];
}

export interface LinkOptions {
  libPaths: string[];
  libFlags: string[];
  target?: TargetPlatform;
  subsystem?: Subsystem;
  extra?: string[];
}

export interface CompileTask {
  source: string;
  object: string;
  relPath: string;
  opts: CompileOptions;
}

export interface LinkTask {
  objects: string[];
  output: string;
  opts: LinkOptions;
  target: "executable" | "shared";
}

export interface ArchiveTask {
  objects: string[];
  output: string;
}

function cacheContext(opts: Partial<CompileOptions>): string {
  const relevant: Record<string, unknown> = {};
  if (opts.optimize) relevant.o = opts.optimize;
  if (opts.debug) relevant.d = true;
  if (opts.standard) relevant.s = opts.standard;
  if (opts.warnings) relevant.w = opts.warnings;
  if (opts.defines?.length) relevant.D = opts.defines;
  if (opts.includePaths?.length) relevant.I = opts.includePaths;
  if (opts.extra?.length) relevant.X = opts.extra;
  return JSON.stringify(relevant);
}

export abstract class Toolchain {
  abstract readonly name: string;

  cacheDir = "";
  private cache: Record<string, string> = {};

  currentTarget: TargetPlatform = HOST_TARGET;

  get objExt(): string { return ".o"; }
  get staticLibExt(): string { return ".a"; }
  get sharedLibExt(): string | null {
    return { win32: ".dll", darwin: ".dylib", linux: ".so" }[this.currentTarget.platform] ?? null;
  }
  get importLibExt(): string | null { return { win32: ".lib" }[this.currentTarget.platform] ?? null; }
  get exeExt(): string { return { win32: ".exe" }[this.currentTarget.platform] ?? ""; }

  abstract isAvailable(): boolean;
  abstract compile(task: CompileTask, cwd?: string): Promise<void>;
  abstract link(task: LinkTask): void;
  abstract archive(task: ArchiveTask): void;

  private computeHash(filePath: string, opts: Partial<CompileOptions>): string {
    const content = readFileSync(filePath);
    const hash = createHash("sha256");
    hash.update(content);
    hash.update(cacheContext(opts));
    return hash.digest("hex");
  }

  private key(moduleName: string, relPath: string): string {
    return `${moduleName}/${relPath}`;
  }

  private isFresh(moduleName: string, task: CompileTask): boolean {
    const hash = this.computeHash(task.source, task.opts);
    return this.cache[this.key(moduleName, task.relPath)] === hash;
  }

  private recordCache(moduleName: string, task: CompileTask): void {
    const hash = this.computeHash(task.source, task.opts);
    this.cache[this.key(moduleName, task.relPath)] = hash;
  }

  loadCache(): void {
    try {
      this.cache = JSON.parse(readFileSync(join(this.cacheDir, "cache.json"), "utf-8"));
    } catch {
      this.cache = {};
    }
  }

  saveCache(): void {
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(join(this.cacheDir, "cache.json"), JSON.stringify(this.cache, null, 2));
  }

  async compileTasks(tasks: CompileTask[], moduleName: string, useCache: boolean, cwd?: string): Promise<void> {
    const toCompile = useCache
      ? tasks.filter(t => {
          if (this.isFresh(moduleName, t)) { process.stderr.write(`  ≡ ${t.relPath}\n`); return false; }
          return true;
        })
      : tasks;

    if (toCompile.length === 0) return;

    for (const t of toCompile) {
      mkdirSync(dirname(t.object), { recursive: true });
      try {
        await this.compile(t, cwd);
        process.stderr.write(`  v ${t.relPath}\n`);
      } catch (err) {
        process.stderr.write(`  x ${t.relPath}\n`);
        throw err;
      }
    }

    if (useCache) {
      for (const t of toCompile) this.recordCache(moduleName, t);
      this.saveCache();
    }
  }

  protected run(tool: string, args: string[]): { stdout: string; stderr: string } {
    const result = spawnSync(tool, args, { stdio: "pipe" });
    if (result.error) throw new Error(`Failed to run "${tool}": ${result.error.message}`);
    if (result.status !== 0) {
      const msg = (result.stderr?.toString() || result.stdout?.toString() || "").trim();
      throw new Error(`${tool} failed: ${msg}`);
    }
    return { stdout: result.stdout?.toString() || "", stderr: result.stderr?.toString() || "" };
  }

  protected runAsync(tool: string, args: string[], extraEnv?: Record<string, string>, cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, CLICOLOR_FORCE: "1", TERM: "xterm-256color", ...extraEnv };
      const proc = spawn(tool, args, { stdio: ["inherit", "pipe", "inherit"], cwd, env });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`"${tool} ${args[0]}" failed with exit code ${code}`));
      });
      proc.on("error", (e: Error) => reject(e));
    });
  }
}
