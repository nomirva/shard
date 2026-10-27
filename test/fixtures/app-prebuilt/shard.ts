import type { ShardConfig } from "../../../src/config";

export default (({ local }) => ({ dependencies: [local("../prebuilt")] })) satisfies ShardConfig;
