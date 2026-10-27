export default ({ sys, framework }) => ({
  dependencies: [sys("m", { linkage: "static" }), framework("CoreFoundation", { linkage: "static" })],
});
