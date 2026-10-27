/** Build with --def GREET (shared lib-greet) or --def MATH (static lib-math). */
export default ({ defined, local }) => {
  if (defined("GREET")) return { dependencies: [local("../lib-greet", { linkage: "shared" })], c: { variant: "greet" } };
  if (defined("MATH")) return { dependencies: [local("../lib-math")], c: { variant: "math" } };
  return {};
};
