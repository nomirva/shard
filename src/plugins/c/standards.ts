import { service, type Configuration, type Module, type Provider } from "../../core";
import { dominates, isPureC, oldestStandard, rankOf } from "../../lang/standards";
import type { CStandard } from "../../lang/types";
import { ShardError } from "../../utils/errors";
import type { CExtension } from "./extension";
import { optional, type CModel } from "./model";

interface Entry {
  readonly module: Module;
  readonly ext: CExtension;
  readonly classpath: Configuration;
  readonly model: Provider<CModel>;
}

/**
 * C standards across the build, worked out on the resolved module graph:
 * - a module without its own `standard.version` compiles with the newest
 *   standard among the modules that use it (C is backwards compatible, so
 *   code that builds as c99 builds as c11; a gnu dialect wins a tie);
 * - every consumer must be able to include the headers its dependencies
 *   export, judged by what those declare (`standard.version`, `support`),
 *   not by what they inherited.
 */
export class CStandards {
  private readonly entries = new Map<string, Entry>();
  private effectiveMemo: Map<string, CStandard | undefined> | null = null;
  private checked = false;

  add(entry: Entry): void {
    this.entries.set(entry.module.path, entry);
  }

  /** Throws on the first incompatibility; runs once per build. */
  effective(module: Module): CStandard | undefined {
    if (!this.checked) {
      this.checked = true;
      this.check();
    }
    return this.effectiveAll().get(module.path);
  }

  private deps(path: string): string[] {
    const entry = this.entries.get(path)!;
    const owners = entry.classpath.incoming.roots().map(n => n.owner).filter(p => this.entries.has(p));
    return [...new Set(owners)];
  }

  private effectiveAll(): Map<string, CStandard | undefined> {
    if (this.effectiveMemo) return this.effectiveMemo;
    const parents = new Map<string, string[]>();
    for (const path of this.entries.keys()) {
      for (const dep of this.deps(path)) parents.set(dep, [...(parents.get(dep) ?? []), path]);
    }
    const memo = new Map<string, CStandard | undefined>();
    const visit = (path: string): CStandard | undefined => {
      if (memo.has(path)) return memo.get(path);
      const own = optional(this.entries.get(path)!.ext.standard)?.version;
      const value = own ?? (parents.get(path) ?? []).map(visit).reduce(newerStandard, undefined);
      memo.set(path, value);
      return value;
    };
    for (const path of this.entries.keys()) visit(path);
    this.effectiveMemo = memo;
    return memo;
  }

  private descendants(path: string): string[] {
    const out: string[] = [];
    const walk = (p: string): void => {
      for (const dep of this.deps(p)) {
        if (out.includes(dep)) continue;
        out.push(dep);
        walk(dep);
      }
    };
    walk(path);
    return out;
  }

  private check(): void {
    const effective = this.effectiveAll();
    for (const [path, consumer] of this.entries) {
      const consumerStd = effective.get(path);
      if (!consumerStd) continue;
      for (const providerPath of this.descendants(path)) {
        const provider = this.entries.get(providerPath)!;
        if (provider.model.get().content.exports.length === 0) continue;
        const declared = optional(provider.ext.standard);
        const baselines = [declared?.version, declared?.support].filter((s): s is CStandard => s !== undefined);
        if (baselines.length === 0 || baselines.some(b => dominates(consumerStd, b))) continue;

        const name = provider.module.name;
        if (baselines.some(b => rankOf(consumerStd) >= rankOf(b) && !isPureC(b) && isPureC(consumerStd))) {
          throw new ShardError(
            "config",
            `Module '${name}' exports GNU-dialect headers, but '${consumer.module.name}' uses pure C (${consumerStd}).`,
            "Exported headers use GNU extensions; a pure C consumer cannot use them.",
          );
        }
        throw new ShardError(
          "config",
          `Module '${name}' exports headers requiring at least ${oldestStandard(baselines)}, but '${consumer.module.name}' uses ${consumerStd}.`,
          `Lower '${name}'.standard.support to '${consumerStd}' if the headers are compatible.`,
        );
      }
    }
  }
}

export const C_STANDARDS = service<CStandards>("c.standards");

export function newerStandard(a: CStandard | undefined, b: CStandard | undefined): CStandard | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (rankOf(a) !== rankOf(b)) return rankOf(a) > rankOf(b) ? a : b;
  return isPureC(a) ? b : a;
}
