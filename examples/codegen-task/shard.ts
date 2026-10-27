import type { ShardConfig } from "../../src/config";

export default {
  plugins: ["c", "clang", "codegen"],
  codegen: {
    command: "sh gen.sh",
    inputs: ["gen.sh", "version.txt"],
    outputs: ["version.c", "version.h"],
  },
} satisfies ShardConfig;
