/** Fixed directory names of the on-disk layout. */
export const DIRS = {
  /** Build state of the root module: objects, task records, dependency outputs. */
  SHARD: ".shard",
  /** Modules fetched by the git plugin. */
  MODULES: "modules",
  /** Outputs of a module. */
  TARGET: "target",
  INCLUDE: "include",
} as const;
