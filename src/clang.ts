import { spawn, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { HOST_TARGET, TargetPlatform, WarningSet, Subsystem, CompileTask, LinkTask, ArchiveTask, CompileOptions, Toolchain } from "./toolchain";

const WARN_MAP: Record<WarningSet, string[]> = {
  none: [],
  default: ["-Wall"],
  extra: ["-Wall", "-Wextra"],
  pedantic: ["-Wall", "-Wextra", "-Wpedantic"],
  all: ["-Wall", "-Wextra", "-Wpedantic", "-Weverything"],
  error: ["-Wall", "-Wextra", "-Werror"],
};

const SUB_MAP: Record<Subsystem, string> = {
  console: "console",
  windows: "windows",
  native: "native",
  efi_application: "efi_application",
};

const KNOWN_ABIS = ["gnu", "musl", "msvc"] as const;

export class ClangToolchain implements Toolchain {
  readonly name = "clang";
  version = "";
  currentTarget: TargetPlatform = { ...HOST_TARGET };

  detect(): boolean {
    const r = spawnSync("clang", ["--version"], { stdio: "pipe" });
    if (r.status !== 0) return false;

    const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    const lines = out.trim().split("\n");
    this.version = lines[0]?.trim() ?? "unknown";

    const targetLine = lines.find(l => l.trim().startsWith("Target:"));
    const target = targetLine?.trim().replace(/^Target:\s*/, "") ?? "";
    this.currentTarget.abi = ClangToolchain.extractAbi(target);

    if (process.platform === "win32" && this.currentTarget.abi !== "gnu") return false;

    return true;
  }

  info(): { name: string; version: string } {
    return { name: this.name, version: this.version };
  }

  private static extractAbi(triple: string): string {
    const last = triple.split("-").pop() ?? "";
    return (KNOWN_ABIS as readonly string[]).includes(last) ? last : "none";
  }

  private cc(args: string[]): void {
    this.run("clang", args);
  }

  get targetDir(): string {
    return `${this.currentTarget.arch}/${this.currentTarget.platform}/${this.currentTarget.abi}`;
  }

  get objExt(): string { return ".o"; }
  get staticLibExt(): string { return ".a"; }
  get sharedLibExt(): string | null {
    return { win32: ".dll", darwin: ".dylib", linux: ".so" }[this.currentTarget.platform] ?? null;
  }
  get importLibExt(): string | null { return { win32: ".lib" }[this.currentTarget.platform] ?? null; }
  get exeExt(): string | null { return { win32: ".exe" }[this.currentTarget.platform] ?? null; }

  private depFilePath(object: string): string {
    return object.replace(/\.\w+$/, ".d");
  }

  private parseDepFile(depFilePath: string): string[] {
    const raw = readFileSync(depFilePath, "utf-8");
    const joined = raw.replace(/\\\r?\n\s*/g, " ");
    const colon = joined.search(/:(?=\s|$)/);
    if (colon === -1) return [];
    const deps = joined.slice(colon + 1).trim();
    return deps.split(/\s+/).filter(Boolean);
  }

  dependencies(task: CompileTask): string[] {
    const depFile = this.depFilePath(task.object);
    try {
      return this.parseDepFile(depFile);
    } catch {
      return [];
    }
  }

  async compile(task: CompileTask, cwd?: string): Promise<void> {
    const args = ClangToolchain.extractArgs(task.source.path, task.object, task.options);
    args.push("-MMD", "-MF", this.depFilePath(task.object));
    await this.runAsync("clang", args, cwd);
  }

  private static extractArgs(src: string, obj: string, opts: CompileOptions): string[] {
    const args: string[] = ["-c"];
    args.push("-fansi-escape-codes", "-fcolor-diagnostics");

    if (opts.optimize) args.push(opts.optimize);
    else args.push("-O2");
    if (opts.debug) args.push("-g");
    if (opts.standard) args.push(opts.standard);
    if (opts.warnings && opts.warnings !== "none") args.push(...WARN_MAP[opts.warnings]);
    if (opts.defines) for (const d of opts.defines) args.push("-D" + d);
    for (const p of opts.includePaths) args.push("-I", p);
    if (opts.extra) args.push(...opts.extra);

    args.push("-o", obj, src);
    return args;
  }

  link(task: LinkTask): void {
    const { libPaths, libFlags, subsystem, extra } = task.options;

    if (task.kind === "executable") {
      const args: string[] = [
        ...task.objects,
        ...this.subsystemFlags(subsystem),
        ...libPaths, ...libFlags,
      ];
      if (this.currentTarget.platform === "darwin") args.push("-Wl,-rpath,@executable_path");
      if (extra) args.push(...extra);
      args.push("-o", task.output);
      this.cc(args);
    } else {
      const args: string[] = [
        ...this.subsystemFlags(subsystem),
        "-shared", ...task.objects, ...libPaths, ...libFlags,
      ];
      if (extra) args.push(...extra);

      if (this.currentTarget.platform === "win32") {
        args.push("-Wl,--out-implib," + task.output.replace(/\.dll$/, ".lib"));
      }

      args.push("-o", task.output);
      this.cc(args);
    }
  }

  archive(task: ArchiveTask): void {
    this.run("ar", ["rcs", task.output, ...task.objects]);
  }

  private subsystemFlags(subsystem?: Subsystem): string[] {
    if (!subsystem) return [];
    return ["-Wl,--subsystem," + SUB_MAP[subsystem]];
  }

  private run(tool: string, args: string[]): void {
    const result = spawnSync(tool, args, { stdio: "pipe" });
    if (result.error) throw new Error(`Failed to run "${tool}": ${result.error.message}`);
    if (result.status !== 0) {
      const msg = (result.stderr?.toString() || result.stdout?.toString() || "").trim();
      throw new Error(`${tool} failed: ${msg}`);
    }
  }

  private runAsync(tool: string, args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, CLICOLOR_FORCE: "1", TERM: "xterm-256color" };
      const proc = spawn(tool, args, { stdio: ["inherit", "pipe", "inherit"], cwd, env });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`"${tool} ${args[0]}" failed with exit code ${code}`));
      });
      proc.on("error", (e: Error) => reject(e));
    });
  }
}

export function detectClangToolchain(): Toolchain {
  const clang = new ClangToolchain();
  if (clang.detect()) return clang;
  throw new Error("No supported toolchain found — install Clang");
}
