import type { ProgressSink } from "./progress";

export type CompileStatus = "cached" | "compiled" | "failed";

/** The only channel through which pipeline stages talk to the user. */
export interface Reporter {
  readonly progress: ProgressSink;
  compile(status: CompileStatus, label: string): void;
  warn(message: string): void;
  /** Called when a pipeline stage starts. */
  stage?(name: string): void;
}
