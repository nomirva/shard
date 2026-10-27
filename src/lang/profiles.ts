import type { Profile } from "./types";
import { ShardError } from "../utils/errors";

export const PROFILE_NAMES = [
  "debug",
  "debug-opt",
  "release",
  "fast",
  "small",
  "tiny",
] as const satisfies readonly Profile[];

export const DEFAULT_PROFILE: Profile = "release";

export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== "string" || !(PROFILE_NAMES as readonly string[]).includes(raw)) {
    throw new ShardError(
      "config",
      `Unknown compilation profile '${String(raw)}'`,
      `Valid profiles: ${PROFILE_NAMES.join(", ")}`,
    );
  }
  return raw as Profile;
}
