import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { ShardError } from "../utils/errors";
import { runAsync, runSync } from "../utils/process";
import type { CStandard } from "../module/types";
import { DEFAULT_PROFILE } from "../module/profiles";
import {
  HOST_TARGET,
  type TargetPlatform,
  type WarningSet,
  type Subsystem,
  type Profile,
  type StandardOptions,
  type CompileTask,
  type LinkTask,
  type ArchiveTask,
  type CompileOptions,
  type Toolchain,
} from "./toolchain";

const PROFILE_MAP: Record<Profile, string[]> = {
  debug: ["-O0", "-g"],
  "debug-opt": ["-O2", "-g"],
  release: ["-O2"],
  fast: ["-O3"],
  small: ["-Os"],
  tiny: ["-Oz"],
};

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

const STD_FLAG: Record<CStandard, string> = {
  c89: "-std=c89",
  c99: "-std=c99",
  c11: "-std=c11",
  c17: "-std=c17",
  c23: "-std=c23",
  gnu89: "-std=gnu89",
  gnu99: "-std=gnu99",
  gnu11: "-std=gnu11",
  gnu17: "-std=gnu17",
  gnu23: "-std=gnu23",
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
    this.currentTarget.abi = extractAbi(target);

    if (process.platform === "win32" && this.currentTarget.abi !== "gnu") return false;
    return true;
  }

  get targetDir(): string {
    return `${this.currentTarget.arch}/${this.currentTarget.platform}/${this.currentTarget.abi}`;
  }

  get sharedLibExt(): string | null {
    return { win32: ".dll", darwin: ".dylib", linux: ".so" }[this.currentTarget.platform] ?? null;
  }

  get exeExt(): string | null {
    return { win32: ".exe" }[this.currentTarget.platform] ?? null;
  }

  dependencies(task: CompileTask): string[] {
    try {
      const raw = readFileSync(depFilePath(task.object), "utf-8");
      const joined = raw.replace(/\\\r?\n\s*/g, " ");
      const colon = joined.search(/:(?=\s|$)/);
      if (colon === -1) return [];
      return joined.slice(colon + 1).trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  }

  async compile(task: CompileTask, cwd?: string): Promise<void> {
    const args = extractArgs(task.source.path, task.object, task.options);
    args.push("-MMD", "-MF", depFilePath(task.object));
    await runAsync("clang", args, { cwd });
  }

  link(task: LinkTask): void {
    const { libPaths, libFlags, subsystem, extra } = task.options;
    const args = task.kind === "executable"
      ? [
          ...task.objects,
          ...subsystemFlags(subsystem),
          ...libPaths,
          ...libFlags,
          ...(this.currentTarget.platform === "darwin" ? ["-Wl,-rpath,@executable_path"] : []),
          ...(extra ?? []),
          "-o",
          task.output,
        ]
      : [
          ...subsystemFlags(subsystem),
          "-shared",
          ...task.objects,
          ...libPaths,
          ...libFlags,
          ...(extra ?? []),
          ...(this.currentTarget.platform === "win32"
            ? ["-Wl,--out-implib," + task.output.replace(/\.dll$/, ".lib")]
            : []),
          "-o",
          task.output,
        ];
    this.run("clang", args);
  }

  archive(task: ArchiveTask): void {
    this.run("ar", ["rcs", task.output, ...task.objects]);
  }

  private run(tool: string, args: string[]): void {
    const r = runSync(tool, args);
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      throw new ShardError("build", `${tool} failed (exit code ${r.status})`, msg || undefined);
    }
  }
}

function extractAbi(triple: string): string {
  const last = triple.split("-").pop() ?? "";
  return (KNOWN_ABIS as readonly string[]).includes(last) ? last : "none";
}

function extractArgs(src: string, obj: string, opts: CompileOptions): string[] {
  const args: string[] = ["-c", "-fansi-escape-codes", "-fcolor-diagnostics"];

  args.push(...PROFILE_MAP[opts.profile ?? DEFAULT_PROFILE]);

  const standard = standardFlag(opts.standard);
  if (standard) args.push(standard);

  args.push(...warningFlags(opts.warnings, opts.standard));

  for (const d of opts.defines ?? []) args.push("-D" + d);
  for (const p of opts.includePaths) args.push("-I", p);
  if (opts.extra) args.push(...opts.extra);

  args.push("-o", obj, src);
  return args;
}

function standardFlag(standard?: StandardOptions): string | null {
  return standard?.version ? STD_FLAG[standard.version] : null;
}

function warningFlags(
  warnings: WarningSet | undefined,
  standard: StandardOptions | undefined,
): string[] {
  const flags = warnings && warnings !== "none" ? [...WARN_MAP[warnings]] : [];
  if (standard?.pedantic === true) flags.push("-Wpedantic");
  else if (standard?.pedantic === "error") flags.push("-pedantic-errors");
  return [...new Set(flags)];
}

function subsystemFlags(subsystem?: Subsystem): string[] {
  return subsystem ? ["-Wl,--subsystem," + SUB_MAP[subsystem]] : [];
}

function depFilePath(object: string): string {
  return object.replace(/\.\w+$/, ".d");
}

export function createClangToolchain(): Toolchain {
  const clang = new ClangToolchain();
  if (clang.detect()) return clang;
  throw new ShardError(
    "toolchain",
    "No supported toolchain found — install Clang",
    "macOS: brew install llvm · Debian/Ubuntu: sudo apt install clang",
  );
}
