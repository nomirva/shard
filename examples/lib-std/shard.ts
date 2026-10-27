import type { ShardConfig } from "../../src/config";

export default {
  c: {
    imports: ["include"],
    exports: ["include"],
    profile: "debug-opt",
    standard: { version: "c11", support: "c99", pedantic: true },
  },
} satisfies ShardConfig;
