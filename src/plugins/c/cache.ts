export type CacheMode = 0 | 1 | 2;

export function cacheEnabled(mode: CacheMode, isRoot: boolean): boolean {
  return mode === 0 || (mode === 1 && !isRoot);
}
