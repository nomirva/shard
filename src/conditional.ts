import type { Toolchain } from "./toolchain/types";

export class ConditionalParser {
  private static COND = /^\$(!?)([a-zA-Z_]+):(.+)$/;

  static compute<T>(tc: Toolchain | undefined, defines: string[], raw: T): T {
    return ConditionalParser.resolve(raw, {
      platform: process.platform,
      arch: process.arch,
      compiler: tc?.name ?? "unknown",
    }, defines) as T;
  }

  private static isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  private static deepMerge(a: unknown, b: unknown): unknown {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (ConditionalParser.isPlainObject(a) && ConditionalParser.isPlainObject(b)) {
      const result: Record<string, unknown> = { ...a };
      for (const k of Object.keys(b)) {
        if (k in result) result[k] = ConditionalParser.deepMerge(result[k], b[k]);
        else result[k] = b[k];
      }
      return result;
    }
    return b;
  }

  private static resolve(obj: unknown, vars: Record<string, string>, defines: string[]): unknown {
    if (!ConditionalParser.isPlainObject(obj)) return obj;

    const out: Record<string, unknown> = {};
    const pending: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      const m = key.match(ConditionalParser.COND);
      if (m) {
        const negate = m[1] === "!";
        const varName = m[2];
        const expected = m[3];
        const actual = vars[varName];

        let match: boolean;
        if (varName === "define") {
          match = defines.some(d => d === expected || d.startsWith(expected + "="));
        } else {
          match = actual === expected;
        }

        if (negate ? !match : match) {
          const resolved = ConditionalParser.resolve(val, vars, defines);
          if (ConditionalParser.isPlainObject(resolved)) {
            for (const [k, v] of Object.entries(resolved)) {
              pending[k] = k in pending ? ConditionalParser.deepMerge(pending[k], v) : v;
            }
          }
        }
      } else {
        out[key] = ConditionalParser.resolve(val, vars, defines);
      }
    }

    for (const [k, v] of Object.entries(pending)) {
      out[k] = k in out ? ConditionalParser.deepMerge(out[k], v) : v;
    }

    return out;
  }
}
