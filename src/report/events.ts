export type CompileStatus = "cached" | "compiled" | "failed";

export type DepAction = "local" | "linked" | "installed" | "upgraded" | "reused" | "duplicate";

export interface DepInfo {
  readonly id: number;
  readonly parentId: number | null;
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

export interface TreeShape {
  readonly name: string;
  readonly repeat: boolean;
  readonly children: readonly TreeShape[];
}

export type LinkKind = "executable" | "static" | "shared";

export type ReportEvent =
  | { type: "run.start"; command: "build" | "update"; details: string[] }
  | { type: "run.end"; command: "build" | "update"; subject: string; artifacts: string[]; removed?: string[] }
  | { type: "deps.declared"; parent: string; parentId: number | null; deps: DepInfo[] }
  | { type: "dep.start"; id: number }
  | { type: "dep.progress"; id: number; percent: number }
  | {
      type: "dep.done";
      dep: DepInfo;
      action: DepAction;
      duration: number;
      previous?: string;
      path?: string;
      flags?: string[];
      warnings: string[];
    }
  | { type: "resolve.end" }
  | { type: "hook.start"; target: string; hook: string; command: string }
  | { type: "hook"; target: string; hook: string; command: string; duration: number; output: string }
  | { type: "build.start"; targets: TargetSummary[]; tree: TreeShape }
  | { type: "target.start"; target: TargetSummary }
  | { type: "compile.start"; target: string; file: string }
  | {
      type: "compile";
      target: string;
      file: string;
      status: CompileStatus;
      duration: number;
      command: string;
      diagnostics: string;
    }
  | { type: "link"; target: string; kind: LinkKind; output: string; duration: number; command: string }
  | { type: "target.end"; target: string; duration: number; outputs: string[] }
  | { type: "warning"; message: string }
  | { type: "program.start"; name: string }
  | { type: "program.end"; name: string; status: number };
