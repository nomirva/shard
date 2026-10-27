import type { ShardConfig } from "../../src/config";

export default {
  c: { profile: "release" },
  scripts: {
    preload: "sh gen.sh",
    preclean: "sh clean.sh",
  },
} satisfies ShardConfig;
