import { PackageShape, LinkType } from "./types";
import { Unit } from "./unit";
import { UserBuildOptions } from "./toolchain";

export interface Target {
  name: string;
  modulePath: string;
  outDir: string;
  type: PackageShape;
  sourceUnits: Unit[];
  headerUnits: Unit[];
  includeDirs: string[];
  options: UserBuildOptions;
  requested: LinkType | null;
}
