import type { CStandard, Profile, StandardOptions, Subsystem, WarningSet } from "./lang/types";
import { parseStandardName } from "./lang/standards";
import { parseProfile } from "./lang/profiles";
import { isPlainObject } from "../../utils/object";
import { ShardError } from "../../utils/errors";

export interface ManifestOptions {
  profile?: Profile;
  standard?: StandardOptions;
  warnings?: WarningSet;
  defines?: string[];
  compileExtra?: string[];
  linkExtra?: string[];
  subsystem?: Subsystem;
}

export function parseOptions(raw: unknown): ManifestOptions {
  if (!isPlainObject(raw)) return {};
  return {
    ...(raw as ManifestOptions),
    profile: raw.profile === undefined ? undefined : parseProfile(raw.profile),
    standard: parseStandard(raw.standard),
  };
}

function parseStandard(raw: unknown): StandardOptions | undefined {
  if (raw === undefined) return undefined;

  if (typeof raw === "string") {
    return { version: parseStandardName(raw) };
  }

  if (isPlainObject(raw)) {
    const version = raw.version === undefined ? undefined : parseVersion(raw.version);
    const support = raw.support === undefined ? undefined : parseSupport(raw.support);
    const pedantic = raw.pedantic;
    if (pedantic !== undefined && typeof pedantic !== "boolean" && pedantic !== "error") {
      throw new ShardError("config", 'options.standard.pedantic must be true, false, or "error"');
    }
    return { version, support, pedantic };
  }

  throw new ShardError("config", "options.standard must be a string or an object");
}

function parseVersion(raw: unknown): CStandard {
  if (typeof raw !== "string") {
    throw new ShardError("config", "options.standard.version must be a string");
  }
  return parseStandardName(raw);
}

function parseSupport(raw: unknown): CStandard {
  if (typeof raw !== "string") {
    throw new ShardError("config", "options.standard.support must be a standard name");
  }
  return parseStandardName(raw);
}
