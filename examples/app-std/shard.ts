export default ({ defined, local }) => ({
  dependencies: [local("../lib-std")],
  c: { profile: "fast", standard: defined("C89") ? "c89" : "c17" },
});
