import type { CStandard, Profile, StandardOptions, Subsystem, WarningSet } from "../../lang/types";
import { DEFAULT_PROFILE } from "../../lang/profiles";
import type { CompileOptions } from "../toolchain";

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

export function compileArgs(src: string, obj: string, opts: CompileOptions): string[] {
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

export function subsystemFlags(subsystem?: Subsystem): string[] {
  return subsystem ? ["-Wl,--subsystem," + SUB_MAP[subsystem]] : [];
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
