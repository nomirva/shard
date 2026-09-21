import { semver } from "bun";
import { ShardError } from "../utils/errors";

export type GitPin =
  | { kind: "version"; value: string }
  | { kind: "branch"; value: string }
  | { kind: "head" };

export function makePin(ref: string | undefined): GitPin {
  if (ref === undefined) return { kind: "head" };
  return isSemver(ref) ? { kind: "version", value: ref } : { kind: "branch", value: ref };
}

export function pinVersion(pin: GitPin): string | null {
  if (pin.kind === "version") return prefixV(pin.value);
  if (pin.kind === "branch") return pin.value;
  return null;
}

export function dirName(name: string, pin: GitPin): string {
  return pin.kind === "head" ? name : `${name}@${pin.value}`;
}

export function pinFromSuffix(name: string, dir: string): GitPin {
  const prefix = name + "@";
  if (!dir.startsWith(prefix)) return { kind: "head" };
  return makePin(dir.slice(prefix.length));
}

export function describePin(pin: GitPin): string {
  if (pin.kind === "version") return pin.value;
  if (pin.kind === "branch") return `branch:${pin.value}`;
  return "HEAD";
}

export function cloneRef(pin: GitPin, subdir?: string): string | null {
  if (pin.kind === "head") return null;
  return subdir ? `${subdir}/${pin.value}` : pin.value;
}

export function altVersionRef(pin: GitPin, subdir?: string): string | null {
  if (pin.kind !== "version") return null;
  const alt = pin.value.startsWith("v") ? pin.value.slice(1) : `v${pin.value}`;
  return subdir ? `${subdir}/${alt}` : alt;
}

export function reconcile(requested: GitPin, installed: GitPin): "reuse" | "reinstall" | "conflict" {
  if (pinsEqual(requested, installed)) return "reuse";
  if (requested.kind !== "version" || installed.kind !== "version") return "conflict";

  const req = requested.value;
  const inst = installed.value;
  if (!isSemver(req)) throw new ShardError("config", `Invalid SemVer for dependency: "${req}"`);
  if (!isSemver(inst)) throw new ShardError("config", `Invalid SemVer recorded for installed module: "${inst}"`);

  if (req.split(".")[0] !== inst.split(".")[0]) return "conflict";
  return semver.order(req, inst) > 0 ? "reinstall" : "reuse";
}

function pinsEqual(a: GitPin, b: GitPin): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "head") return true;
  return a.value === (b as { value: string }).value;
}

function prefixV(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

export function isSemver(s: string): boolean {
  try { semver.order(s, s); return true; } catch { return false; }
}
