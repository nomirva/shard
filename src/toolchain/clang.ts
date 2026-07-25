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

const KNOWN_ABIS = ["gnu", "musl", "msvc"] as const;

function extractAbi(triple: string): string {
  const last = triple.split("-").pop() ?? "";
  return (KNOWN_ABIS as readonly string[]).includes(last) ? last : "none";
}

export class ClangToolchain extends Toolchain {
  name = "clang";

  detect(): boolean {
    const r = spawnSync("clang", ["--version"], { stdio: "pipe" });
    if (r.status !== 0) return false;

    const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
    const lines = out.trim().split("\n");
    this.version = lines[0]?.trim() ?? "unknown";

    const targetLine = lines.find(l => l.trim().startsWith("Target:"));
    const target = targetLine?.trim().replace(/^Target:\s*/, "") ?? "";
    this.currentTarget.abi = extractAbi(target);

    if (process.platform === "win32" && this.currentTarget.abi !== "gnu") return false;

    return true;
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
    const joined = raw.replace(/\\\r?\n\s*/g, " ");
    const colon = joined.search(/:(?=\s|$)/);
    if (colon === -1) return [];
    const deps = joined.slice(colon + 1).trim();
    return deps.split(/\s+/).filter(Boolean);
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
