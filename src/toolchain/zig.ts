import { existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import type { CompileOptions, WarningSet, Subsystem, CompileTask, LinkTask, ArchiveTask } from "./types";
import { Toolchain } from "./types";

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

export class ZigToolchain extends Toolchain {
  name = "zig";

  isAvailable(): boolean {
    return spawnSync("zig", ["version"], { stdio: "pipe" }).status === 0;
  }

  private cc(args: string[]): void {
    this.run("zig", ["cc", ...args]);
  }

  private static compileArgs(src: string, obj: string, opts: CompileOptions): string[] {
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

  async compile(task: CompileTask, cwd?: string): Promise<void> {
    const cacheDir = task.object + ".zig-cache";
    await this.runAsync("zig", ["cc", ...ZigToolchain.compileArgs(task.source, task.object, task.opts)], { ZIG_GLOBAL_CACHE_DIR: cacheDir }, cwd);
    rmSync(cacheDir, { recursive: true, force: true });
  }

  link(task: LinkTask): void {
    const { libPaths, libFlags, subsystem, extra } = task.opts;

    if (task.target === "executable") {
      const args: string[] = [
        ...task.objects,
        ...this.subsystemFlags(subsystem),
        ...libPaths, ...libFlags,
      ];
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
    this.run("zig", ["ar", "rcs", task.output, ...task.objects]);
  }

  wipeZigCache(cacheDir: string): void {
    try {
      for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
        if (entry.name === ".zig-cache" || entry.name.endsWith(".zig-cache"))
          rmSync(join(cacheDir, entry.name), { recursive: true, force: true });
        if (entry.isDirectory()) {
          const sub = join(cacheDir, entry.name, ".zig-cache");
          if (existsSync(sub)) rmSync(sub, { recursive: true, force: true });
        }
      }
    } catch { /* */ }
  }

  private subsystemFlags(subsystem?: Subsystem): string[] {
    if (!subsystem) return [];
    return ["-Wl,--subsystem," + SUB_MAP[subsystem]];
  }
}
