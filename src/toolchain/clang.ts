import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import type { WarningSet, Subsystem, CompileTask, LinkTask, ArchiveTask, CompileOptions } from "./types";
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

function extractArgs(src: string, obj: string, opts: CompileOptions): string[] {
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

export class ClangToolchain extends Toolchain {
  name = "clang";

  isAvailable(): boolean {
    return spawnSync("clang", ["--version"], { stdio: "pipe" }).status === 0;
  }

  private cc(args: string[]): void {
    this.run("clang", args);
  }

  depFilePath(task: CompileTask): string {
    return task.object.replace(/\.\w+$/, ".d");
  }

  dependencyGenFlags(depFilePath: string): string[] {
    return ["-MMD", "-MF", depFilePath];
  }

  parseDepFile(depFilePath: string): string[] {
    const raw = readFileSync(depFilePath, "utf-8");
    const joined = raw.replace(/\\\n\s*/g, " ");
    const colon = joined.indexOf(":");
    if (colon === -1) return [];
    const deps = joined.slice(colon + 1).trim();
    return deps.split(/\s+/).filter(p => p && !p.startsWith("/usr/") && !p.startsWith("/Library/"));
  }

  async compile(task: CompileTask, cwd?: string): Promise<void> {
    const args = extractArgs(task.source, task.object, task.opts);
    args.push(...this.dependencyGenFlags(this.depFilePath(task)));
    await this.runAsync("clang", args, undefined, cwd);
  }

  link(task: LinkTask): void {
    const { libPaths, libFlags, subsystem, extra } = task.opts;

    if (task.target === "executable") {
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
}
