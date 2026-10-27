/*
 * Everything the pipeline has to say to the user, as data. Stages emit
 * events; renderers in cli/console decide how they look (live TTY, plain CI).
 * Paths are absolute; renderers shorten them.
 */

export type CompileStatus = "cached" | "compiled" | "failed";

/** How a dependency edge was satisfied. */
export type DepAction = "local" | "linked" | "installed" | "upgraded" | "reused" | "duplicate";

export interface DepInfo {
  /** Unique per edge within one run. */
  readonly id: number;
  /** 0 for direct dependencies of the root. */
  readonly depth: number;
  readonly name: string;
  readonly source: string;
  readonly spec: string;
  readonly link: string | null;
}

export interface TargetSummary {
  readonly name: string;
  readonly shape: string;
  readonly standard?: string;
  readonly profile: string;
  readonly files: number;
}

export type LinkKind = "executable" | "static" | "shared";

export type ReportEvent =
  | { type: "run.start"; noun: string; title: string; details: string[] }
  | { type: "run.end"; label: string; artifacts: string[]; stats?: string[] }
  | { type: "dep.start"; dep: DepInfo }
  | { type: "dep.progress"; id: number; percent: number }
  | {
      type: "dep.done";
      dep: DepInfo;
      action: DepAction;
      duration: number;
      /** Pin replaced by an upgrade. */
      previous?: string;
      /** Where the module lives on disk. */
      path?: string;
      /** Link flags produced for system dependencies. */
      flags?: string[];
      warnings: string[];
    }
  | { type: "hook"; target: string; hook: string; command: string; duration: number; output: string }
  | { type: "build.start"; targets: TargetSummary[] }
  | { type: "target.start"; target: TargetSummary }
  | { type: "compile.start"; target: string; file: string }
  | {
      type: "compile";
      target: string;
      file: string;
      status: CompileStatus;
      duration: number;
      command: string;
      /** Compiler warnings and errors for this file. */
      diagnostics: string;
    }
  | { type: "link"; target: string; kind: LinkKind; output: string; duration: number; command: string }
  | { type: "target.end"; target: string; duration: number; outputs: string[] }
  | { type: "warning"; message: string }
  | { type: "program.start"; name: string }
  | { type: "program.end"; name: string; status: number };
