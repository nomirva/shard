export type ErrorCode =
  | "usage"
  | "config"
  | "toolchain"
  | "git"
  | "conflict"
  | "build"
  | "script"
  | "unknown";

export type ErrorDetail = [label: string, value: string];

export interface ErrorExtra {
  details?: ErrorDetail[];
  output?: string;
}

export class ShardError extends Error {
  readonly details: ErrorDetail[];
  readonly output?: string;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    extra: ErrorExtra = {},
  ) {
    super(message);
    this.name = "ShardError";
    this.details = extra.details ?? [];
    this.output = extra.output;
  }
}

export interface ErrorView {
  code: ErrorCode;
  message: string;
  hint?: string;
  details: ErrorDetail[];
  output?: string;
}

export function viewError(e: unknown): ErrorView {
  if (e instanceof ShardError) {
    return { code: e.code, message: e.message, hint: e.hint, details: e.details, output: e.output };
  }
  if (e instanceof Error) return { code: "unknown", message: e.message, details: [] };
  return { code: "unknown", message: String(e), details: [] };
}
