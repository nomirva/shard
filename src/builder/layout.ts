import { join } from "path";
import type { Module } from "../module/module";
import type { TargetPlatform } from "../toolchain/toolchain";
import { DIRS } from "../utils/constants";
import { moduleId } from "../utils/paths";

export class Layout {
  readonly id: string;
  readonly moduleDir: string;
  readonly outDir: string;
  readonly objectDir: string;
  readonly includeDir: string;

  constructor(module: Module, target: TargetPlatform, rootPath: string) {
    this.id = moduleId(rootPath, module.path);
    this.moduleDir = module.path === rootPath ? module.path : join(rootPath, DIRS.SHARD, module.name);

    const triple = `${target.arch}/${target.platform}/${target.abi}`;
    const variant = module.manifest.target;
    this.outDir = join(this.moduleDir, DIRS.TARGET, variant ? join(triple, variant) : triple);
    this.objectDir = join(rootPath, DIRS.SHARD, this.id);
    this.includeDir = join(this.outDir, DIRS.INCLUDE);
  }
}
