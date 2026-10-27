import { ShardError } from "../utils/errors";
import type { ModuleContent } from "./content";

export enum PackageShape {
  Executable = "executable",
  Library = "library",
  Prebuilt = "prebuilt",
  HeaderOnly = "header-only",
}

export function deriveShape(content: ModuleContent, label: string): PackageShape {
  if (content.sources.some(u => u.isMain)) return PackageShape.Executable;
  if (content.sources.length > 0) return PackageShape.Library;
  if (content.artifacts.length > 0) return PackageShape.Prebuilt;
  if (content.exports.length > 0) return PackageShape.HeaderOnly;
  throw new ShardError("config", `Module "${label}" is empty: no sources, exports, or artifacts`);
}
