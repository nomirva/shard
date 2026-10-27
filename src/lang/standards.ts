import { ShardError } from "../utils/errors";
import type { CStandard } from "./types";

export const C_STANDARDS: readonly CStandard[] = [
  "c89", "c99", "c11", "c17", "c23",
  "gnu89", "gnu99", "gnu11", "gnu17", "gnu23",
];

const RANK: Record<CStandard, number> = {
  c89: 0, gnu89: 0,
  c99: 1, gnu99: 1,
  c11: 2, gnu11: 2,
  c17: 3, gnu17: 3,
  c23: 4, gnu23: 4,
};

export function isCStandard(value: string): value is CStandard {
  return (C_STANDARDS as readonly string[]).includes(value);
}

export function parseStandardName(name: string): CStandard {
  if (isCStandard(name)) return name;

  const hint = name.includes("++")
    ? `C++ is not supported. Supported: ${C_STANDARDS.join(", ")}`
    : `Supported: ${C_STANDARDS.join(", ")}`;
  throw new ShardError("config", `Unknown standard '${name}'`, hint);
}

export function olderStandard(
  a: CStandard | undefined,
  b: CStandard | undefined,
): CStandard | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (RANK[a] !== RANK[b]) return RANK[a] < RANK[b] ? a : b;
  return a.startsWith("gnu") ? b : a;
}

export function rankOf(standard: CStandard): number {
  return RANK[standard];
}

export function oldestStandard(list: readonly CStandard[]): CStandard | undefined {
  return list.reduce<CStandard | undefined>((oldest, s) => olderStandard(oldest, s), undefined);
}

export function isPureC(standard: CStandard): boolean {
  return !standard.startsWith("gnu");
}

export function dominates(consumer: CStandard, baseline: CStandard): boolean {
  if (RANK[consumer] < RANK[baseline]) return false;
  return isPureC(baseline) || !isPureC(consumer);
}

