import { PackageShape } from "./types";
import type { Manifest } from "./manifest";
import { deriveShape, type ModuleContent } from "./content";
import { ShardError } from "../utils/errors";

export class Module {
  readonly path: string;
  readonly name: string;
  readonly manifest: Manifest;
  content: ModuleContent | null = null;

  constructor(path: string, name: string, manifest: Manifest) {
    this.path = path;
    this.name = name;
    this.manifest = manifest;
  }

  get shape(): PackageShape {
    if (!this.content) {
      throw new ShardError("config", `Module "${this.name}" is not materialized`);
    }
    return deriveShape(this.content, this.name);
  }

  get declaredDeps(): readonly string[] {
    return this.manifest.depend;
  }
}
