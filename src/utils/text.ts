const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/** Number of compiler diagnostic lines of the given severity ("error", "warning"). */
export function countDiagnostics(output: string, severity: "error" | "warning"): number {
  const re = new RegExp(`\\b${severity}:`);
  return stripAnsi(output).split("\n").filter(line => re.test(line)).length;
}
