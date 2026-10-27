export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function pushUnique<T>(target: T[], values: readonly T[], key: (v: T) => unknown = v => v): void {
  for (const value of values) {
    if (!target.some(existing => key(existing) === key(value))) target.push(value);
  }
}
