export interface ConditionalContext {
  compiler: string;
  platform: string;
  arch: string;
  defines: string[];
}

export function resolveConditionals<T>(raw: T, ctx: ConditionalContext): T {
  const vars: Record<string, string> = {
    platform: ctx.platform,
    arch: ctx.arch,
    compiler: ctx.compiler,
  };
  for (const d of ctx.defines) {
    const eq = d.indexOf("=");
    vars[d.slice(0, eq === -1 ? d.length : eq)] = eq === -1 ? "" : d.slice(eq + 1);
  }
  return resolve(raw, vars, ctx.defines) as T;
}

const COND = /^\?([a-zA-Z_]+)(:|!)(.+)$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (isPlainObject(a) && isPlainObject(b)) {
    const result: Record<string, unknown> = { ...a };
    for (const k of Object.keys(b)) {
      result[k] = k in result ? deepMerge(result[k], b[k]) : b[k];
    }
    return result;
  }
  return b;
}

function resolve(obj: unknown, vars: Record<string, string>, defines: string[]): unknown {
  if (!isPlainObject(obj)) return obj;

  const out: Record<string, unknown> = {};
  const pending: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const m = key.match(COND);
    if (!m) {
      out[key] = resolve(val, vars, defines);
      continue;
    }

    const negate = m[2] === "!";
    const varName = m[1];
    const expected = m[3];
    const match = varName === "define"
      ? defines.some(d => d === expected || d.startsWith(expected + "="))
      : vars[varName] === expected;

    if (negate ? !match : match) {
      const resolved = resolve(val, vars, defines);
      if (isPlainObject(resolved)) {
        for (const [k, v] of Object.entries(resolved)) {
          pending[k] = k in pending ? deepMerge(pending[k], v) : v;
        }
      }
    }
  }

  for (const [k, v] of Object.entries(pending)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }

  return out;
}
