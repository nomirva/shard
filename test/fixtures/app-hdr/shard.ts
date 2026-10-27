import type { ShardConfig } from "../../../src/config";

export default (({ local }) => ({ dependencies: [local("../hdr-only")] })) satisfies ShardConfig;
