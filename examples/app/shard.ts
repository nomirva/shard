import type { ShardConfig } from "../../src/config";

export default (({ defined, local }) => {
  if (defined("GREET")) return { dependencies: [local("../lib-greet", { linkage: "shared" })], c: { variant: "greet" } };
  if (defined("MATH")) return { dependencies: [local("../lib-math")], c: { variant: "math" } };
  return {};
}) satisfies ShardConfig;
