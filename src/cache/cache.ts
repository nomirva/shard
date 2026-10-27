import type { CompileTask, DependencyTracker } from "../toolchain/toolchain";
import { fingerprint } from "./fingerprint";
import type { CacheStore } from "./store";

/** 0 = cache on, 1 = ignore cache of the root module, 2 = ignore all cache. */
export type CacheMode = 0 | 1 | 2;

export function cacheEnabled(mode: CacheMode, isRoot: boolean): boolean {
  return mode === 0 || (mode === 1 && !isRoot);
}

export class CompileCache {
  constructor(
    private readonly store: CacheStore,
    private readonly tracker: DependencyTracker,
  ) {}

  isFresh(key: string, task: CompileTask): boolean {
    return this.store.get(key) === fingerprint(task, this.tracker);
  }

  record(key: string, task: CompileTask): void {
    this.store.set(key, fingerprint(task, this.tracker));
  }

  save(): void {
    this.store.flush();
  }
}
